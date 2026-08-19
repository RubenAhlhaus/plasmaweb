# Jog tests (frontend)

Short overview of the main frontend tests around jog logic (X/Y/Z jogging on the Home screen).  
Goal: quickly see **what** each test covers and whether a given aspect of jog behavior is covered.

## `src/lib/__tests__/jogVelocity.test.ts`

- Default jog speed, clamping/snapping to 1 mm/min steps (range 1–1000).

## `src/lib/__tests__/jogIncrements.test.ts`

- **`parseJogIncrementsSpec` – INI formats**  
  Parses comma-separated specs (`3 mm, 2 mm, 1/8 in`), gmoccapy space-separated glued units (`10mm 5mm 1mm .1mm …`), and space-separated value/unit pairs without commas (`1 mm 0.5 mm`). Asserts the **four-button** UI cap (`MAX_JOG_INCREMENT_BUTTONS`).

- **`parseJogIncrementLabelToMm` – button labels**  
  Converts increment tab labels (e.g. `10mm`, `3 mm`, `1/8 in`) to machine units for assertions; throws on invalid labels.

## `src/components/__tests__/IncrementSelector.test.tsx`

- Renders increment tabs from `iniRuntimeConfig.jog_increments_spec` (comma-separated and gmoccapy examples).
- The **Continuous** tab label is resolved via `i18n.t('jogIncrements.continuous', { ns: 'components' })` (Vitest uses `en` from `setupTests.ts`).

## `src/components/__tests__/DirectionalControl.test.tsx`

- **Continuous – context menu / hold-to-jog**  
  With jog preconditions met and `jogMode: "continuous"`, pointer down on `[data-e2e="jog-y-positive"]` publishes `jog.move`; `contextmenu` is `defaultPrevented`; pointer up publishes `jog.stop`. Asserts continuous-only `touch-none` class is present.
- **Continuous – secondary pointer button ignored**  
  `pointerdown` with `button: 2` does not publish `jog.move`.
- **Incremental – no hold touch classes**  
  In `jogMode: "incremental"`, the same button has no `touch-none` class; `aria-label` comes from `components:jogDirectional.yPositive` (English in Vitest).

## `src/hooks/__tests__/useJogCommand.test.tsx`

- **`useJogCommand` – incremental jog X+**  
  Sets mock WebSocket in store, `jogMode: "incremental"`, increment `1.5`, and `jogVelocityMmPerMin`. Asserts a `motion.jog` command with `jointMode: false`, `index: 0` (X axis), `mode: "increment"`, `distance: 1.5`, and positive `velocity` equal to `jogVelocityMmPerMin`.

- **`useJogCommand` – continuous jog Z−**  
  Sets mock WebSocket, `jogMode: "continuous"`, and `jogVelocityMmPerMin`. Asserts a `motion.jog` command with `jointMode: false`, `index: 2` (Z axis), `mode: "continuous"` without `distance`, and negative `velocity` whose magnitude is `jogVelocityMmPerMin`.

## `e2e/tests/jogging.spec.ts`

- **Incremental jog (E2E)**  
  On the Home screen via UI:
  - first checks the header shows **manual task mode** (`headerTaskModeManualLocator` → `data-e2e="header-task-mode-on"` and `data-task-mode="manual"`; visible short label “Manual”, tooltip text still “Manual mode” in `AppTooltip`) — otherwise the test fails here,
  - then reads active increment buttons from `IncrementSelector` dynamically,
  - converts labels via `parseJogIncrementLabelToMm` from `src/lib/jogIncrements.ts` (supports `10 mm` and `10mm` labels),
  - for each axis X/Y/Z runs sequence `-,-,+`,
  - and verifies displayed coordinates change by exactly the selected increment (or factor 2).

Additionally the “axis is not homed” dialog in the unhomed case is confirmed with “Understood…” so jogging continues reliably.
