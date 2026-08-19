import type { Locator, Page } from 'playwright/test';

/** Visible when `task_state === STATE_ESTOP` or hardware estop (`HeaderBar`). */
export function headerEstopActiveLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-estop-active"]');
}

/** Visible for `STATE_ESTOP_RESET` or `STATE_OFF` without estop (`HeaderBar`). */
export function headerMachineOffLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-machine-off"]');
}

/** Visible for `STATE_ON` — short label Manual/Program/MDI (`HeaderBar`). */
export function headerTaskModeOnLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-task-mode-on"]');
}

/** Visible while a program is running/waiting in auto (`isProgramFileExecuting`, not paused). */
export function headerProgramRunningLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-program-running"]');
}

/** Visible while program interpretation is paused (`isProgramInterpreterPaused`). */
export function headerProgramPausedLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-program-paused"]');
}

/** Visible when connected and any jog axis is not homed (`HeaderBar`). */
export function headerUnhomedAxesLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-unhomed-axes"]');
}

/** Manual mode display (`data-task-mode="manual"`). */
export function headerTaskModeManualLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-task-mode-on"][data-task-mode="manual"]');
}

/** Power icon: open exit dialog (`HeaderBar`). */
export function headerExitOpenLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-exit-open"]');
}

/** Dialog: close window (`HeaderBar`). */
export function headerExitCloseWindowLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-exit-close-window"]');
}

/** Dialog: close window and shut down the system (`HeaderBar`). */
export function headerExitCloseWindowShutdownLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-exit-close-window-shutdown"]');
}

/** Dialog: cancel (`HeaderBar`). */
export function headerExitCancelLocator(page: Page): Locator {
  return page.locator('[data-e2e="header-exit-cancel"]');
}
