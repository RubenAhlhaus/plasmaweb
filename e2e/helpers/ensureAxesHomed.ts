import { expect, type Page } from 'playwright/test';

import { headerUnhomedAxesLocator } from './headerBarStatusLocators';

/**
 * Homes all axes via the header unhomed indicator → Homing dialog → Home all.
 * No-op when axes are already homemed (indicator hidden).
 */
export async function ensureAxesHomed(page: Page): Promise<void> {
  const unhomed = headerUnhomedAxesLocator(page);
  if (!(await unhomed.isVisible().catch(() => false))) return;

  await unhomed.click();
  const homeAll = page.locator('[data-e2e="homing-home-all"]');
  await expect(homeAll).toBeVisible({ timeout: 10_000 });
  await homeAll.click();
  await expect(unhomed).toBeHidden({ timeout: 60_000 });
}
