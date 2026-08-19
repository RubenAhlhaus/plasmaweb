import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

import i18n, { i18nReady } from '@/i18n/config';

// jsdom has no matchMedia, and components that size themselves by breakpoint (jog panel,
// plasma screen) call it during mount.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Same gap for ResizeObserver, which the jog panel uses to pick its size.
if (typeof globalThis.ResizeObserver !== 'function') {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = NoopResizeObserver;
}

beforeEach(async () => {
  await i18nReady;
  await i18n.changeLanguage('en');
});

