# CLATTER PWA — Installable Offline Drum Workstation

CLATTER can be installed as a standalone Progressive Web App (PWA) and run completely offline while preserving the exact LXR-02 WebAssembly DSP engine, AudioWorklet, Web Workers, factory samples, Web MIDI, and local persistence.

## Architecture

- **Build & integration**: `vite-plugin-pwa` (`2.0.0`) integrated in [`vite.config.ts`](../vite.config.ts) with `registerType: 'prompt'` and `injectRegister: false`.
- **Relative deployment**: `base: './'`, `start_url: './'`, `scope: './'`, and relative icon paths ensure the same build works at `/` (local preview) and `/clatter/` (GitHub Pages at `https://ovelhaaa.github.io/clatter/`).
- **Lifecycle controller**: [`src/pwa.ts`](../src/pwa.ts) (`PwaController`) manages Service Worker registration, update detection, `beforeinstallprompt` handling, online/offline status, and persistent storage requests.
- **Visual identity**: Pixel-art monochrome icons (`192×192` and `512×512`, standard + `maskable`, plus `180×180` Apple touch icon) are generated deterministically from the 16×16 CLATTER mark by [`scripts/gen-pwa-icons.mjs`](../scripts/gen-pwa-icons.mjs) into `public/icons/`.

## Cache Strategy

- **Precache only (build-time Workbox manifest)**: All static application assets are precached on Service Worker installation (`globPatterns: ['**/*.{js,css,html,wasm,woff,woff2,png,svg,json,wav,txt,md}']`, `maximumFileSizeToCacheInBytes: 5 MiB`):
  - `index.html` and `manifest.webmanifest`
  - Main JS/CSS bundles (`dist/assets/index-*.js`, `dist/assets/index-*.css`)
  - LXR WebAssembly engine (`dist/assets/lxr-*.wasm`)
  - AudioWorklet (`dist/assets/worklet-*.js`) and Kit Web Worker (`dist/assets/kitWorker-*.js`)
  - Bundled `@fontsource/*` fonts (`.woff`, `.woff2`)
  - Factory demo samples (`dist/samples/index.json` and `dist/samples/*.wav`)
  - Icons and license/notice files
- **No external runtime dependencies**: All synthesis, fonts, and factory samples are served locally.
- **User libraries stay in IndexedDB**: User-imported audio samples are stored content-addressed (SHA-256) in IndexedDB (`clatter-samples`), never copied into Cache Storage.
- **Outdated cache cleanup**: `cleanupOutdatedCaches: true` removes superseded Workbox precache buckets on activation without touching `IndexedDB` or `localStorage`.

## Installation

### Chrome / Edge (Windows, macOS, Linux, Android)

1. Open `https://ovelhaaa.github.io/clatter/` (or your local preview URL).
2. Wait for the page to finish loading. When the browser offers installation:
   - Click the discreet **INSTALL** button in the top-right status bar, or
   - Use **CLATTER → Install CLATTER…**, or
   - Click the install icon in the browser address bar.
3. Confirm installation. CLATTER opens in its own standalone window without browser chrome.

### Safari (iOS / iPadOS & macOS)

Browsers without `beforeinstallprompt` can still install CLATTER manually via **CLATTER → Install as app…** (or **HELP → Install as app…**):
- **iOS / iPadOS Safari**: Tap **Share** → **Add to Home Screen**.
- **macOS Safari**: Choose **File → Add to Dock**.

## Offline Behavior

Once loaded online and precached by the Service Worker, CLATTER works with no internet connection:

- UI boot, bundled fonts, and 15 factory samples (`samples/index.json` + `.wav`)
- LXR WebAssembly compilation (`lxr.wasm`), `AudioWorklet` (`worklet.ts`), and `KitWorker` (`kitWorker.ts`)
- Live sequencing, pattern generation/mutation, kit generation/mutation, modulation, FX, Destruction, and Perform
- Local project autosave, preset loading, `.clatter.json` / `.clatter.zip` import/export, and WAV/MIDI export

## Persistence of Projects, Kits, and Samples

- **`localStorage`**:
  - `clatter.project`: current project autosave (debounced 800 ms, flushed on `pagehide` and before an in-app PWA update reload). If `localStorage` is full or blocked, CLATTER now displays a non-intrusive error toast instead of failing silently.
  - `clatter.prefs`: UI, MIDI, export, and seed preferences.
  - `clatter.palette.*`: selected colour palette.
  - `clatter:synth-kits`: saved synth kits.
- **`IndexedDB`** (via `@slopfactory/core`):
  - `clatter-samples`: user-imported audio samples (content-addressed by SHA-256).
  - `clatter-sample-sets` and `clatter-full-kits`: saved sample sets and full kits.
- Service Worker updates never clear `IndexedDB` or `localStorage`. On app installation, CLATTER also requests `navigator.storage.persist()` when supported.

## Update Policy (Safe for Live Audio)

- `registerType: 'prompt'` with `skipWaiting: false` and `clientsClaim: false`.
- **Never interrupts playback**: A waiting Service Worker never forces `skipWaiting` or reloads automatically while the sequencer is running or an export is in progress.
- When a new version is detected, a discreet **`UPDATE AVAILABLE`** button appears in the status bar (and in the **CLATTER** menu).
- Clicking **`UPDATE AVAILABLE`**:
  - If playback or an export is active, CLATTER opens a confirmation dialog (`STOP & UPDATE` / `LATER`) so a live performance cannot be cut off accidentally.
  - Otherwise, it flushes any pending autosave (`app.flushSave()`), activates the new Service Worker, and reloads cleanly so assets from different versions are never mixed.

## Web MIDI Limitations

- Web MIDI (`navigator.requestMIDIAccess`) is supported in Chromium-based browsers (Chrome, Edge) over HTTPS or `localhost`, including installed standalone PWAs on desktop and Android.
- Safari and Firefox (and iOS browsers using WebKit) do not expose Web MIDI natively; in those environments CLATTER accurately reports `This browser has no Web MIDI` without simulating unavailable hardware support.
- MIDI permissions are governed by the browser and must be granted by the user.

## Testing Locally

```bash
npm ci
npm run build
npm run preview
```

To run the full automated Playwright suite (including PWA manifest, Service Worker, precache, offline reload, audio/WASM/Worklet, sample persistence, WAV/MIDI export, safe update during playback, and `/clatter/` subpath):

```bash
npm run build && npm run test:e2e
```

To test only the PWA spec:

```bash
npm run build && npx playwright test e2e/pwa.spec.ts
```

## Verifying the Published Build

1. Open `https://ovelhaaa.github.io/clatter/` in Chrome or Edge.
2. In DevTools → **Application**:
   - **Manifest**: verify `CLATTER`, `display: standalone`, `#000000` theme/background, and 192×192 + 512×512 (`any` + `maskable`) icons.
   - **Service Workers**: verify `sw.js` is activated and controlling `/clatter/`.
   - **Cache Storage**: verify `workbox-precache-v2-...` contains `index.html`, `lxr-*.wasm`, `worklet-*.js`, `kitWorker-*.js`, and `samples/*`.
3. In DevTools → **Network**, switch to **Offline**, reload the page, press **SPACE** to play, and confirm audio, pattern/kit generation, and WAV/MIDI export work without network requests.
