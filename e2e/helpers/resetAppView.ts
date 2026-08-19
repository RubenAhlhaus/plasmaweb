import type { Page } from 'playwright/test';
import { expect } from 'playwright/test';

import { headerEstopActiveLocator } from './headerBarStatusLocators';
import { Sidebar } from '../pages/Sidebar';
import { Screens } from '../pages/Screens';

async function dismissErrorToasts(page: Page): Promise<void> {
  const closeButtons = page.getByRole('button', { name: 'Fehlermeldung schließen' });

  // ErrorToast uses an overlay with `pointer-events` that can block clicks.
  // We best-effort dismiss all visible toasts before interacting with the UI.
  for (let i = 0; i < 5; i += 1) {
    const first = closeButtons.first();
    const visible = await first.isVisible().catch(() => false);
    if (!visible) break;
    await first.click().catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

/**
 * Closes modal dialogs (Escape + “Dialog schließen” button) so overlays do not block clicks.
 * Used in reset and in per-test teardown before touching sidebars / virtual keys.
 */
async function dismissModalDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape');
  }
  const closeDialogButton = page.getByRole('button', { name: 'Dialog schließen' });
  for (let i = 0; i < 5; i += 1) {
    const visible = await closeDialogButton.first().isVisible().catch(() => false);
    if (!visible) break;
    await closeDialogButton.first().click().catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

export async function resetAppView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __LCNCGUI_E2E__?: { resetMacroQueue?: () => void } };
    w.__LCNCGUI_E2E__?.resetMacroQueue?.();
  });
  await dismissErrorToasts(page);
  await dismissModalDialogs(page);

  const sidebar = new Sidebar(page);
  await sidebar.clickByTitle('Home');
  await expect(new Screens(page).homeMarker()).toBeVisible();

  await sidebar.clickByTitle('Settings');
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  const virtualSidebarSwitch = page
    .locator('[data-e2e="settings-row-virtual-sidebar"]')
    .getByRole('switch');
  const isEnabled = (await virtualSidebarSwitch.getAttribute('aria-checked')) === 'true';
  if (!isEnabled) {
    await virtualSidebarSwitch.click();
    await expect(virtualSidebarSwitch).toHaveAttribute('aria-checked', 'true');
  }

  await sidebar.clickByTitle('Home');
  await expect(new Screens(page).homeMarker()).toBeVisible();

  await dismissErrorToasts(page);
}

/**
 * Ensures the virtual estop is active (toggle via softkey 4 if needed).
 * Not used by the default `appPage` fixture: leaving machine state as-is between
 * tests avoids an ESTOP-reset + machine-on cycle on every run; use this only when a
 * spec must end in ESTOP for isolation.
 */
export async function ensureNotausActive(page: Page): Promise<void> {
  const statusNotaus = () => headerEstopActiveLocator(page);
  const softkeyNotAus = page.locator('[data-e2e="virtual-sidebar-button-4"]');

  const ensureHomeIfNeeded = async () => {
    if (await softkeyNotAus.isVisible().catch(() => false)) return;
    const sidebar = new Sidebar(page);
    await sidebar.clickByTitle('Home');
    await expect(new Screens(page).homeMarker()).toBeVisible({ timeout: 60_000 });
  };

  await dismissErrorToasts(page);
  // Runs before the next test’s resetAppView; an open Homing (or other) modal would
  // intercept sidebar/virtual clicks and cause long waits on homeMarker / softkeys.
  await dismissModalDialogs(page);
  await ensureHomeIfNeeded();

  await expect(softkeyNotAus).toBeVisible({ timeout: 10_000 });
  const alreadyNotaus = await statusNotaus().isVisible().catch(() => false);
  if (!alreadyNotaus) {
      await softkeyNotAus.click().catch(async () => {
      await dismissErrorToasts(page);
      await softkeyNotAus.click().catch(() => undefined);
    });
    await expect(statusNotaus()).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
  }

  await dismissErrorToasts(page);
}
