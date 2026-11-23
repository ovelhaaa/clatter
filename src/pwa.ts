/**
 * PWA lifecycle: Service Worker registration (prompt-based, safe for live audio),
 * update detection without interrupting playback, and non-intrusive install support.
 *
 * Copyright (C) 2026 The CLATTER contributors. SPDX-License-Identifier: GPL-3.0-only
 */
import { registerSW } from 'virtual:pwa-register';
import type { App } from './app/app';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PwaState {
  supported: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  canInstall: boolean;
  standalone: boolean;
  online: boolean;
}

type Listener = (state: PwaState) => void;

export class PwaController {
  readonly state: PwaState;
  private listeners = new Set<Listener>();
  private updateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
  private installPrompt: BeforeInstallPromptEvent | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private initialized = false;

  constructor(private app: App) {
    const standalone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true);

    this.state = {
      supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      offlineReady: false,
      updateAvailable: false,
      canInstall: false,
      standalone,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    };
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  init(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    window.addEventListener('online', () => {
      this.state.online = true;
      this.emit();
      void this.checkForUpdates();
    });
    window.addEventListener('offline', () => {
      this.state.online = false;
      this.emit();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as BeforeInstallPromptEvent;
      this.state.canInstall = !this.state.standalone;
      this.emit();
    });

    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.state.canInstall = false;
      this.emit();
      this.app.say('CLATTER INSTALLED');
      void this.requestPersistentStorage();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.app.ui.playing) {
        void this.checkForUpdates();
      }
    });

    if (!this.state.supported) return;

    this.updateFn = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        this.state.updateAvailable = true;
        this.emit();
      },
      onOfflineReady: () => {
        this.state.offlineReady = true;
        this.emit();
      },
      onRegisteredSW: (_swUrl, reg) => {
        this.registration = reg ?? null;
        if (reg) {
          setInterval(() => {
            if (!this.app.ui.playing && navigator.onLine) {
              void reg.update();
            }
          }, 30 * 60 * 1000);
        }
      },
      onRegisterError: (err) => {
        console.warn('Service worker registration failed:', err);
      },
    });
  }

  async checkForUpdates(): Promise<void> {
    if (!this.registration || !navigator.onLine) return;
    try {
      await this.registration.update();
    } catch {
      /* offline or transient network error */
    }
  }

  /**
   * Apply a waiting Service Worker update.
   * Flushes any pending project autosave before reloading.
   * Refuses to reload silently while the sequencer is playing unless `force` is true.
   */
  async applyUpdate(force = false): Promise<boolean> {
    if (!this.updateFn || !this.state.updateAvailable) return false;
    if (this.app.ui.playing && !force) return false;
    if (this.app.ui.playing && force) this.app.stop();
    this.app.flushSave();
    await this.updateFn(true);
    return true;
  }

  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.installPrompt) return 'unavailable';
    const prompt = this.installPrompt;
    this.installPrompt = null;
    this.state.canInstall = false;
    this.emit();
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      void this.requestPersistentStorage();
    }
    return outcome;
  }

  async requestPersistentStorage(): Promise<boolean> {
    try {
      if (navigator.storage?.persist) {
        return await navigator.storage.persist();
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}
