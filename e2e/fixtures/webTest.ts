import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

import { E2E_VIEWPORT } from '../constants/testEnv';
import { E2E_LOCALE_STORAGE_KEY, E2E_UI_LOCALE } from '../helpers/e2eLocale';
import {
  E2E_SHOW_VIRTUAL_SIDEBAR,
  E2E_SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY,
} from '../helpers/e2eVirtualSidebar';
import { ensureVirtualSidebarMachineOn } from '../helpers/ensureVirtualSidebarMachineOn';
import { attachOutgoingWebSocketTap } from '../helpers/outgoingWebSocketCommands';
import { resetAppView } from '../helpers/resetAppView';
import { Sidebar } from '../pages/Sidebar';

type WorkerFixtures = {
  sharedContext: BrowserContext;
  sharedPage: Page;
};

type TestFixtures = {
  appPage: Page;
  /** When true: skip `ensureVirtualSidebarMachineOn` (no ESTOP/machine setup via WebSocket). */
  skipVirtualSidebarMachineOn: boolean;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  skipVirtualSidebarMachineOn: [false, { option: true }],
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ viewport: E2E_VIEWPORT });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  sharedPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      await page.goto('/');
      await page.evaluate(
        ([localeKey, lng, sidebarKey, showSidebar]) => {
          window.localStorage.setItem(localeKey, lng);
          window.localStorage.setItem(sidebarKey, showSidebar);
        },
        [E2E_LOCALE_STORAGE_KEY, E2E_UI_LOCALE, E2E_SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY, E2E_SHOW_VIRTUAL_SIDEBAR] as const,
      );
      await page.reload();
      await expect(new Sidebar(page).buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });
      await use(page);
    },
    { scope: 'worker' },
  ],

  appPage: async ({ sharedPage, skipVirtualSidebarMachineOn }, use) => {
    await resetAppView(sharedPage);
    if (!skipVirtualSidebarMachineOn) {
      const setupTap = attachOutgoingWebSocketTap(sharedPage);
      try {
        // `page.on('websocket')` only sees new connections — reload after attaching the tap.
        const wsOpened = sharedPage.waitForEvent('websocket', { timeout: 30_000 });
        await sharedPage.reload({ waitUntil: 'domcontentloaded' });
        await wsOpened;
        await expect(new Sidebar(sharedPage).buttonByTitle('Home')).toBeVisible({ timeout: 60_000 });
        await ensureVirtualSidebarMachineOn(sharedPage, setupTap);
      } finally {
        setupTap.dispose();
      }
    }
    await use(sharedPage);
  },
});

export { expect };
