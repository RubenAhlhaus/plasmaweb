import { expect, test } from '../fixtures/webTest';
import {
  attachOutgoingWebSocketTap,
  matchProgramLoadToolTable,
  matchProgramMdiWithText,
  matchToolAddRow,
  matchToolDeleteRow,
  matchToolTouchOff,
  matchToolUpdateRow,
} from '../helpers/outgoingWebSocketCommands';
import {
  deleteToolViaUiIfPresent,
  fillCreateDisplayName,
  fillCreateToolNumber,
  fillEditOffsetZ,
  navigateToTools,
  openAddToolDialog,
  parseToolNumberFromId,
  pickE2eToolNumber,
  toolDetailsActionBar,
  toolEditDialog,
  toolIdFromNumber,
  toolTableRow,
} from '../helpers/toolTableE2e';
import { Screens } from '../pages/Screens';

test.describe.configure({ mode: 'serial' });

test.describe('tool-table', () => {
  test('T1 Tools screen heading', async ({ appPage }) => {
    await navigateToTools(appPage);
    await expect(new Screens(appPage).toolsMarker()).toBeVisible();
  });

  test('T2 selected tool shows detail panel', async ({ appPage }) => {
    await navigateToTools(appPage);
    await expect(appPage.getByText('Ausgewähltes Werkzeug')).toBeVisible();
    const first = appPage.locator('[data-e2e="tools-table-row"]').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(appPage.getByRole('heading', { level: 3 })).toBeVisible();
  });

  test('T3 reload sends program.load_tool_table', async ({ appPage }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      await navigateToTools(appPage);
      const next = tap.waitForNextOutgoingCommand(matchProgramLoadToolTable(), { timeoutMs: 20_000 });
      await appPage.getByRole('button', { name: 'Werkzeugtabelle neu laden' }).click();
      await next;
    } finally {
      tap.dispose();
    }
  });

  test('T5 duplicate tool number shows validation', async ({ appPage }) => {
    await navigateToTools(appPage);
    const first = appPage.locator('[data-e2e="tools-table-row"]').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    const occupied = await first.getAttribute('data-tool-id');
    const n = parseToolNumberFromId(occupied ?? '');
    test.skip(n == null, 'no tool id on first row');
    await openAddToolDialog(appPage);
    await fillCreateToolNumber(appPage, String(n));
    await expect(appPage.getByText('Diese T-Nummer ist bereits vergeben.')).toBeVisible();
    await expect(
      toolEditDialog(appPage, 'Neues Werkzeug').getByRole('button', { name: 'Hinzufügen' }),
    ).toBeDisabled();
    await toolEditDialog(appPage, 'Neues Werkzeug').getByRole('button', { name: 'Abbrechen' }).click();
  });

  test('T4–T7 tool table add, update Z offset, delete roundtrip', async ({ appPage }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    let t = 0;
    try {
      await navigateToTools(appPage);
      t = await pickE2eToolNumber(appPage);
      const tid = toolIdFromNumber(t);
      await deleteToolViaUiIfPresent(appPage, tid, tap);

      await test.step('T4 add', async () => {
        await openAddToolDialog(appPage);
        await fillCreateToolNumber(appPage, String(t));
        await fillCreateDisplayName(appPage, `E2E Tool ${t}`);
        const next = tap.waitForNextOutgoingCommand(matchToolAddRow(t), { timeoutMs: 30_000 });
        await toolEditDialog(appPage, 'Neues Werkzeug').getByRole('button', { name: 'Hinzufügen' }).click();
        await next;
        await expect(toolEditDialog(appPage, 'Neues Werkzeug')).toBeHidden({ timeout: 15_000 });
      });

      await test.step('T4b row visible', async () => {
        const row = toolTableRow(appPage, tid);
        await expect(row).toHaveCount(1, { timeout: 45_000 });
        await row.scrollIntoViewIfNeeded();
        await expect(row).toContainText(`E2E Tool ${t}`);
      });

      await test.step('T6 update Z', async () => {
        await toolTableRow(appPage, tid).click();
        await toolDetailsActionBar(appPage).getByRole('button', { name: 'Bearbeiten' }).click();
        await expect(toolEditDialog(appPage, 'Werkzeug bearbeiten')).toBeVisible();
        await fillEditOffsetZ(appPage, '-0.123');
        const next = tap.waitForNextOutgoingCommand(matchToolUpdateRow(t), { timeoutMs: 30_000 });
        await toolEditDialog(appPage, 'Werkzeug bearbeiten')
          .getByRole('button', { name: 'Speichern' })
          .click();
        await next;
      });

      await test.step('T6b Z column', async () => {
        const row = toolTableRow(appPage, tid);
        await row.scrollIntoViewIfNeeded();
        await expect
          .poll(
            async () => {
              await row.scrollIntoViewIfNeeded().catch(() => undefined);
              const txt = await row.innerText();
              return txt.includes('-0.123');
            },
            { timeout: 45_000 },
          )
          .toBe(true);
      });

      await test.step('T7 delete', async () => {
        await toolTableRow(appPage, tid).click();
        await toolDetailsActionBar(appPage).getByRole('button', { name: 'Löschen' }).click();
        const next = tap.waitForNextOutgoingCommand(matchToolDeleteRow(t), { timeoutMs: 30_000 });
        await appPage
          .getByRole('dialog')
          .filter({ has: appPage.getByRole('heading', { name: 'Werkzeug löschen?' }) })
          .getByRole('button', { name: 'Löschen' })
          .click();
        await next;
      });

      await test.step('T7b row gone', async () => {
        await expect(toolTableRow(appPage, tid)).toHaveCount(0, { timeout: 45_000 });
      });
    } finally {
      if (t > 0) {
        await deleteToolViaUiIfPresent(appPage, toolIdFromNumber(t), tap).catch(() => undefined);
      }
      tap.dispose();
    }
  });

  test('T8 T9 T11 M6 mdi, active spindle UI, tool touch_off', async ({ appPage }) => {
    const tap = attachOutgoingWebSocketTap(appPage);
    try {
      await navigateToTools(appPage);
      // Row without "Aktiv": otherwise UI replaces load tool with "tool in spindle".
      const rowForM6 = appPage
        .locator('[data-e2e="tools-table-row"]')
        .filter({ hasNot: appPage.getByText('Aktiv', { exact: true }) })
        .first();
      await expect(rowForM6).toBeVisible({ timeout: 15_000 });
      const tid = (await rowForM6.getAttribute('data-tool-id')) ?? '';
      const toolno = parseToolNumberFromId(tid);
      if (toolno == null) {
        throw new Error('expected data-tool-id with T<number> on first tool row');
      }

      await rowForM6.click();
      const nextMdi = tap.waitForNextOutgoingCommand(matchProgramMdiWithText(`T${toolno} M6 G43`), {
        timeoutMs: 25_000,
      });
      await toolDetailsActionBar(appPage).getByRole('button', { name: 'Werkzeug einwechseln' }).click();
      await nextMdi;

      await expect
        .poll(
          async () =>
            appPage.getByText('Werkzeug in Spindel').isVisible().catch(() => false),
          { timeout: 25_000 },
        )
        .toBe(true);

      await expect(toolTableRow(appPage, tid).getByText('Aktiv')).toBeVisible({
        timeout: 10_000,
      });

      const nextTouch = tap.waitForNextOutgoingCommand(matchToolTouchOff('z', 0), {
        timeoutMs: 30_000,
      });
      await appPage.getByRole('button', { name: 'Werkzeug-Touch-Off' }).click();
      const touchDialog = appPage.getByRole('dialog').filter({
        has: appPage.getByRole('heading', { name: /Werkzeug-Touch-Off/ }),
      });
      await expect(touchDialog).toBeVisible();
      await touchDialog.getByLabel('Achse').click();
      const axisPicker = appPage.locator('[data-e2e="tool-touch-off-axis-picker"]');
      await expect(axisPicker).toBeVisible();
      await axisPicker.getByRole('option', { name: 'Z' }).click();
      await touchDialog.getByLabel('Zielwert').fill('0');
      await touchDialog.getByRole('button', { name: 'Anwenden' }).click();
      await nextTouch;
    } finally {
      tap.dispose();
    }
  });

  test('T10 keyboard moves selection between rows', async ({ appPage }) => {
    await navigateToTools(appPage);
    const rows = appPage.locator('[data-e2e="tools-table-row"]');
    const count = await rows.count();
    test.skip(count < 2, 'need at least two tools for keyboard nav');
    await rows.first().focus();
    const nameBefore = await appPage.getByRole('heading', { level: 3 }).first().innerText();
    await appPage.keyboard.press('ArrowDown');
    await expect
      .poll(async () => appPage.getByRole('heading', { level: 3 }).first().innerText(), {
        timeout: 5_000,
      })
      .not.toBe(nameBefore);
  });
});
