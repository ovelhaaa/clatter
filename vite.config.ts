import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

/** The licence and notices travel with the published site (GPL-3.0 and the LXR's terms). */
function notices(): Plugin {
  const files: [string, string][] = [
    ['LICENSE', 'LICENSE.txt'],
    ['NOTICE.md', 'NOTICE.md'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['lxr/upstream/NOTICE.md', 'LXR_FIRMWARE_NOTICE.md'],
  ];
  return {
    name: 'clatter-notices',
    apply: 'build',
    generateBundle() {
      for (const [from, fileName] of files) this.emitFile({ type: 'asset', fileName, source: readFileSync(from) });
    },
  };
}

export default defineConfig({
  // Relative paths: the same build works at the custom domain root and under /<repo>/.
  base: './',
  server: { port: 5231 },
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [
    notices(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: './',
        name: 'CLATTER',
        short_name: 'CLATTER',
        description: 'Generative Drum Synthesis & Rhythmic Destruction',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#000000',
        background_color: '#000000',
        categories: ['music', 'utilities'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,woff,woff2,png,svg,json,wav,txt,md}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        dontCacheBustURLsMatching: /assets\//,
        navigateFallback: 'index.html',
      },
    }),
  ],
  define: {
    __BUILD_COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? commit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
} as never);
