/**
 * CLATTER PWA & offline verification against the production build (`vite preview`):
 * manifest, Service Worker registration & precache, full offline reload, WASM + AudioWorklet
 * startup, playback, kit generation, project autosave, imported sample persistence (IndexedDB),
 * WAV/MIDI export offline, non-disruptive update during active playback, and `/clatter/` subpath.
 */
import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

type W = {
  clatter: import('../src/app/app').App;
  clatterPwa: import('../src/pwa').PwaController;
};

/** Minimal valid 16-bit mono 44.1 kHz WAV (256 samples of a decaying click). */
function makeTestWavBytes(): number[] {
  const sampleRate = 44100;
  const numSamples = 256;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.sin(i * 0.25) * Math.exp(-i / 60);
    view.setInt16(44 + i * 2, Math.round(s * 24000), true);
  }
  return Array.from(new Uint8Array(buf));
}

async function waitForControlledSw(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active && !!navigator.serviceWorker.controller;
    },
    null,
    { timeout: 20_000 },
  );
}

test('PWA manifest, Service Worker, precache, and full offline drum workstation', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // 1. Open the site online
  await page.goto('./');
  await page.waitForSelector('#transport', { timeout: 30_000 });

  // 2. Validate manifest and icons
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifestRes = await page.request.get(manifestHref!);
  expect(manifestRes.ok()).toBe(true);
  const manifest = await manifestRes.json();
  expect(manifest.name).toBe('CLATTER');
  expect(manifest.short_name).toBe('CLATTER');
  expect(manifest.description).toBe('Generative Drum Synthesis & Rhythmic Destruction');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#000000');
  expect(manifest.background_color).toBe('#000000');
  expect(manifest.orientation).toBe('any');

  const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
  expect(icons.some((i) => i.sizes === '192x192' && i.purpose !== 'maskable')).toBe(true);
  expect(icons.some((i) => i.sizes === '512x512' && i.purpose !== 'maskable')).toBe(true);
  expect(icons.some((i) => i.sizes === '192x192' && i.purpose === 'maskable')).toBe(true);
  expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  for (const icon of icons) {
    const iconRes = await page.request.get(icon.src);
    expect(iconRes.ok(), `icon ${icon.src} should return 200`).toBe(true);
  }

  // 3. Validate Service Worker registration (reload once if controller not yet attached on very first visit)
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('#transport', { timeout: 30_000 });
  await waitForControlledSw(page);

  // 4. Confirm essential cache is populated (WASM, worklet, worker, samples, index.html)
  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const k of keys) {
      const cache = await caches.open(k);
      const reqs = await cache.keys();
      for (const r of reqs) urls.push(r.url);
    }
    return urls;
  });
  expect(cachedUrls.some((u) => u.includes('index.html'))).toBe(true);
  expect(cachedUrls.some((u) => /\.wasm(\?|$)/.test(u))).toBe(true);
  expect(cachedUrls.some((u) => /worklet-.*\.js/.test(u))).toBe(true);
  expect(cachedUrls.some((u) => /kitWorker-.*\.js/.test(u))).toBe(true);
  expect(cachedUrls.some((u) => u.includes('samples/index.json'))).toBe(true);
  expect(cachedUrls.some((u) => u.includes('samples/kick-dusty.wav'))).toBe(true);

  // Prepare persistent state online before going offline: import a sample + modify project tempo
  const wavBytes = makeTestWavBytes();
  const persisted = await page.evaluate(async (bytes) => {
    const a = (window as unknown as W).clatter;
    const file = new File([new Uint8Array(bytes)], 'pwa-test-kick.wav', { type: 'audio/wav' });
    await a.importSamples([file]);
    const imported = a.library.list().find((s) => !s.bundled && s.name.includes('PWA-TEST-KICK'));
    a.setTempo(137, false);
    a.saveNow();
    return { sampleId: imported?.id ?? null, tempo: a.project.tempo };
  }, wavBytes);
  expect(persisted.sampleId).toBeTruthy();
  expect(persisted.tempo).toBe(137);

  // 5. Disable network connection (true offline mode)
  await context.setOffline(true);

  // 6. Reload the application offline
  await page.reload();
  await page.waitForSelector('#transport', { timeout: 30_000 });

  // 7. Verify WASM initialization & factory samples offline
  const bootOffline = await page.evaluate(() => {
    const a = (window as unknown as W).clatter;
    return {
      hasModule: a.module !== null,
      hasInitKit: a.initKit !== null,
      bundledCount: a.library.list().filter((s) => s.bundled).length,
      tempo: a.project.tempo,
    };
  });
  expect(bootOffline.hasModule).toBe(true);
  expect(bootOffline.hasInitKit).toBe(true);
  expect(bootOffline.bundledCount).toBeGreaterThanOrEqual(15);

  // 11 & 12. Verify saved project & imported sample persisted across offline reload
  expect(bootOffline.tempo).toBe(137);
  const sampleAfterReload = await page.evaluate((id) => {
    const a = (window as unknown as W).clatter;
    return !!a.library.get(id!);
  }, persisted.sampleId);
  expect(sampleAfterReload).toBe(true);

  // 8 & 9. Verify AudioWorklet initialization and play a pattern offline
  await page.click('[data-test=play]');
  await expect.poll(() => page.evaluate(() => (window as unknown as W).clatter.ui.playing), { timeout: 5000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).clatter.host.state), { timeout: 5000 }).toBe('running');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).clatter.meters?.masterL ?? 0), { intervals: [50], timeout: 5000 })
    .toBeGreaterThan(0.01);

  // 14. Simulate an update notification while playing and ensure performance is NOT interrupted
  await page.evaluate(() => {
    const pwa = (window as unknown as W).clatterPwa;
    pwa.state.updateAvailable = true;
    // Notify listeners via onChange by triggering a state emit
    (pwa as unknown as { emit: () => void }).emit();
  });
  await expect(page.locator('[data-test=pwa-update]')).toBeVisible();
  await expect(page.locator('[data-test=pwa-update]')).toHaveText('UPDATE AVAILABLE');

  // Playing must continue uninterrupted
  const stillPlaying = await page.evaluate(async () => {
    const a = (window as unknown as W).clatter;
    const pwa = (window as unknown as W).clatterPwa;
    return { playing: a.ui.playing, ctx: a.host.state, applyBlocked: await pwa.applyUpdate(false) };
  });
  expect(stillPlaying.playing).toBe(true);
  expect(stillPlaying.ctx).toBe('running');
  expect(stillPlaying.applyBlocked).toBe(false);

  // Clicking UPDATE AVAILABLE while playing opens confirmation dialog instead of killing audio
  await page.click('[data-test=pwa-update]');
  await expect(page.locator('[role="dialog"]')).toContainText('UPDATE AVAILABLE');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as W).clatter.ui.playing)).toBe(true);

  // Stop playback
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as unknown as W).clatter.ui.playing)).toBe(false);

  // 10. Generate a new kit offline
  const beforeKit = await page.evaluate(() => JSON.stringify((window as unknown as W).clatter.project.kit));
  await page.evaluate(() => (window as unknown as W).clatter.generateKit());
  const afterKit = await page.evaluate(() => JSON.stringify((window as unknown as W).clatter.project.kit));
  expect(afterKit).not.toBe(beforeKit);

  // 13. Validate WAV and MIDI export offline
  const exports = await page.evaluate(async () => {
    const a = (window as unknown as W).clatter;
    const wav = await a.exportMaster(1, 0.2);
    const midi = a.exportMidiFile(1);
    return {
      wavName: wav.name,
      wavHeader: String.fromCharCode(...wav.data.slice(0, 4)),
      wavWave: String.fromCharCode(...wav.data.slice(8, 12)),
      wavLen: wav.data.length,
      midiName: midi.name,
      midiHeader: String.fromCharCode(...midi.data.slice(0, 4)),
      midiLen: midi.data.length,
    };
  });
  expect(exports.wavHeader).toBe('RIFF');
  expect(exports.wavWave).toBe('WAVE');
  expect(exports.wavLen).toBeGreaterThan(44);
  expect(exports.midiHeader).toBe('MThd');
  expect(exports.midiLen).toBeGreaterThan(14);

  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('PWA works under /clatter/ subpath (GitHub Pages layout) online and offline', async ({ browser }) => {
  const distDir = resolve('dist');
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.wav': 'audio/wav',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
  };

  const server = createServer(async (req, res) => {
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (rawPath === '/clatter') {
      res.writeHead(301, { Location: '/clatter/' });
      res.end();
      return;
    }
    if (!rawPath.startsWith('/clatter/')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const rel = rawPath.slice('/clatter/'.length) || 'index.html';
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const file = join(distDir, safe);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const subUrl = `http://127.0.0.1:${port}/clatter/`;

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  try {
    await page.goto(subUrl);
    await page.waitForSelector('#transport', { timeout: 30_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector('#transport', { timeout: 30_000 });
    await waitForControlledSw(page);

    const swScope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(swScope).toBe(subUrl);

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#transport', { timeout: 30_000 });

    const ok = await page.evaluate(() => {
      const a = (window as unknown as W).clatter;
      return a.module !== null && a.library.list().filter((s) => s.bundled).length >= 15;
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
