import type { Page } from 'playwright/test';

import { expect } from '../fixtures/webTest';
import { Screens } from '../pages/Screens';
import { Sidebar } from '../pages/Sidebar';

import type { OutgoingWebSocketTap } from './outgoingWebSocketCommands';
import { matchToolDeleteRow } from './outgoingWebSocketCommands';

/**
 * Optional lower bound for E2E T numbers (`E2E_TOOL_TABLE_T`).
 * If unset, returns `undefined` — then `pickE2eToolNumber` uses only `max+1`.
 */
export function e2eToolTableTFloor(): number | undefined {
  const raw = process.env.E2E_TOOL_TABLE_T;
  if (raw == null || raw.trim() === '' || !/^\d+$/.test(raw.trim())) return undefined;
  const n = parseInt(raw.trim(), 10);
  return n > 0 ? n : undefined;
}

export function toolIdFromNumber(n: number): string {
  return `T${n}`;
}

export function parseToolNumberFromId(toolId: string): number | undefined {
  const m = /^T(\d+)$/i.exec(toolId);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Highest T number in the current table (0 if empty). */
export async function maxToolNumberOnPage(page: Page): Promise<number> {
  const rows = page.locator('[data-e2e="tools-table-row"]');
  const n = await rows.count();
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    const id = await rows.nth(i).getAttribute('data-tool-id');
    const t = parseToolNumberFromId(id ?? '');
    if (t != null && t > max) max = t;
  }
  return max;
}

/**
 * T number for E2E create: `max(T in table)+1`, optionally raised to `E2E_TOOL_TABLE_T`.
 */
export async function pickE2eToolNumber(page: Page): Promise<number> {
  const floor = e2eToolTableTFloor();
  const max = await maxToolNumberOnPage(page);
  let t = floor !== undefined ? Math.max(max + 1, floor) : max + 1;
  for (let guard = 0; guard < 50; guard += 1) {
    if ((await toolTableRow(page, toolIdFromNumber(t)).count()) === 0) return t;
    t += 1;
  }
  throw new Error('pickE2eToolNumber: could not find a free T slot');
}

export async function navigateToTools(page: Page): Promise<void> {
  await new Sidebar(page).clickByTitle('Tools');
  await expect(new Screens(page).toolsMarker()).toBeVisible({ timeout: 60_000 });
}

export function toolTableRow(page: Page, toolId: string) {
  return page.locator(`[data-e2e="tools-table-row"][data-tool-id="${toolId}"]`);
}

/** Action bar under tool details (load tool, edit, delete, …). */
export function toolDetailsActionBar(page: Page) {
  return page.locator('[data-e2e="tool-details-actions"]');
}

export async function openAddToolDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Neues Werkzeug' }).click();
  await expect(page.getByRole('heading', { name: 'Neues Werkzeug' })).toBeVisible();
  const dlg = toolEditDialog(page, 'Neues Werkzeug');
  const nameInput = dlg.locator('[data-e2e="tool-edit-display-name"]');
  await expect(nameInput).toBeVisible();
  // Wait until create form is reset (else Playwright may fill before reset).
  await expect(nameInput).toHaveValue('');
}

export function toolEditDialog(page: Page, title: 'Neues Werkzeug' | 'Werkzeug bearbeiten') {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });
}

export async function fillCreateToolNumber(page: Page, toolNumber: string): Promise<void> {
  const dlg = toolEditDialog(page, 'Neues Werkzeug');
  await dlg.locator('[data-e2e="tool-edit-create-toolno"]').click();
  await page.locator('[data-e2e="tool-edit-create-toolno-touch-entry"]').fill(toolNumber);
  await page.locator('[data-e2e="tool-edit-create-toolno-ok"]').click();
}

export async function fillEditOffsetZ(page: Page, value: string): Promise<void> {
  const dlg = toolEditDialog(page, 'Werkzeug bearbeiten');
  await dlg.locator('[data-e2e="tool-edit-offset-Z"]').click();
  await page.locator('[data-e2e="tool-edit-offset-Z-touch-entry"]').fill(value);
  await page.locator('[data-e2e="tool-edit-offset-Z-ok"]').click();
}

export async function fillCreateDisplayName(page: Page, name: string): Promise<void> {
  const dlg = toolEditDialog(page, 'Neues Werkzeug');
  await dlg.locator('[data-e2e="tool-edit-display-name"]').fill(name);
}

/** Entfernt die Zeile per UI, falls sichtbar (Best-Effort-Cleanup). */
export async function deleteToolViaUiIfPresent(
  page: Page,
  toolId: string,
  tap: OutgoingWebSocketTap,
): Promise<void> {
  const toolno = parseToolNumberFromId(toolId);
  if (toolno == null) return;

  await navigateToTools(page);
  const row = toolTableRow(page, toolId);
  if (!(await row.isVisible().catch(() => false))) return;

  await row.click();
  await toolDetailsActionBar(page).getByRole('button', { name: 'Löschen' }).click();
  const next = tap.waitForNextOutgoingCommand(matchToolDeleteRow(toolno), { timeoutMs: 30_000 });
  await page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Werkzeug löschen?' }) })
    .getByRole('button', { name: 'Löschen' })
    .click();
  await next;
}
