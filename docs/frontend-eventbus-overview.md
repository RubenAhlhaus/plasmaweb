## Frontend event bus — general guideline

This document describes the general architecture of the frontend event bus and states that **all buttons in the UI should fire events** instead of executing logic or API calls directly.

### Core principle

- **Buttons fire events**:
  - Each button only calls `eventBus.publish(...)` in `onClick` (or similar handlers).
  - Buttons contain **no business logic**, no direct `sendCommand` calls, and no complex state manipulation.
- **Listeners encapsulate logic**:
  - Actual logic (e.g. WebSocket commands, state updates, telemetry) lives in listeners subscribed to events.
  - Multiple listeners can receive the same event (e.g. command handler + logging).

That keeps UI components slim, easier to test, and events can be logged and analyzed centrally.

### Event bus module

- File: `src/eventBus.ts`
- Typed event map (excerpt):

```ts
type FrontendEventMap = {
  'jog.move': {
    axis: 'x' | 'y' | 'z';
    direction: 'positive' | 'negative';
  };
  'jog.stop': {
    axis: 'x' | 'y' | 'z';
  };
  'ui.homing.openDialog': {
    source: 'virtualSidebar' | 'hotkey' | 'hal' | 'header';
  };
  'ui.homing.select': {
    action: 'home' | 'unhome';
    axis: 'all' | 'x' | 'y' | 'z';
  };
  'ui.machine.toggle': {
    source: 'virtualSidebar' | 'hotkey' | 'hal' | 'header';
  };
  'ui.estop.toggle': {
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.flood.toggle': {
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.spindle.direction': {
    direction: 'forward' | 'reverse' | 'stop';
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.hal.softkey': {
    slot: 14 | 15 | 16;
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.coordinates.openDialog': {
    source: 'coordinatesDisplay';
  };
  'ui.coordinates.openAxisDialog': {
    axis: 'x' | 'y' | 'z';
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.program.pause': {
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.program.stop': {
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.program.cycleStart': {
    source: 'virtualSidebar' | 'hotkey' | 'hal';
  };
  'ui.macros.generateProgram': {
    source: 'macrosScreen';
  };
  'ui.spindle.openDialog': {
    source: 'sliderControl';
  };
  'ui.feed.openDialog': {
    source: 'sliderControl';
  };
  'ui.feed.setOverride': {
    percent: number;
    source: 'hotkey';
  };
  'ui.spindle.setOverride': {
    percent: number;
    source: 'hotkey';
  };
  // more events here, e.g.:
  // 'program.run': { source: 'toolbar' | 'macros'; programId: string };
};
```

- API:

```ts
eventBus.publish('jog.move', payload);
eventBus.subscribe('jog.move', handler);
eventBus.publish('jog.stop', payload);
eventBus.subscribe('jog.stop', handler);
```

### Example: homing dialog

- Virtual sidebar (`VirtualButtonSidebar`):
  - The `Home` button fires `eventBus.publish('ui.homing.openDialog', { source: 'virtualSidebar' })` on click.
- **Keyboard shortcut** (Settings → virtual sidebar hotkeys, global listener):
  - The same event with `source: 'hotkey'` when the configured shortcut for softkey 2 is pressed. See [`docs/features/09_VIRTUAL_SIDEBAR_HOTKEYS.md`](features/09_VIRTUAL_SIDEBAR_HOTKEYS.md).
- Header status bar (`HeaderBar`):
  - When connected and any jog axis is not homed, an orange **Not homed (X, …)** indicator is shown next to the machine status. Clicking it fires `eventBus.publish('ui.homing.openDialog', { source: 'header' })`.
- Global dialog (`HomingDialog`):
  - Subscribes to `ui.homing.openDialog` and opens a dialog with five large actions (home all / per-axis home / unhome all). Visible labels and `aria-label` text come from the **`components`** i18n namespace (`components.json` → `homing.*` under `src/locales/{en,de}/`), so copy is **locale-dependent**; stable automation hooks use `data-e2e` values such as `homing-home-all`, `homing-home-x`, …, `homing-unhome-all`.
  - On a **home** action, the dialog fires `eventBus.publish('ui.homing.select', { action: 'home', axis: ... })`.
  - On **unhome all**, the dialog fires `eventBus.publish('ui.homing.select', { action: 'unhome', axis: 'all' })`.
  - `HomingEventListener` subscribes to `ui.homing.select`; `useHomingCommands` translates the event into `motion.home` or `motion.unhome` and sends it to the backend.

### Example: coordinates / axis dialog

- Coordinates display (`CoordinatesDisplay` on Home/Program):
  - On click fires `eventBus.publish('ui.coordinates.openDialog', { source: 'coordinatesDisplay' })`.
- Virtual sidebar (`VirtualButtonSidebar`):
  - Buttons `X`, `Y`, `Z` fire:
    - `ui.coordinates.openAxisDialog` with `axis: 'x'`
    - `ui.coordinates.openAxisDialog` with `axis: 'y'`
    - `ui.coordinates.openAxisDialog` with `axis: 'z'`
  - The same events with `source: 'hotkey'` when configured keyboard shortcuts are used.
- Global dialog host (`CoordinatesDialogHost`):
  - Subscribes to both events and opens `CoordinateSystemsDialog` centrally.
  - For `ui.coordinates.openAxisDialog`, the matching sub-dialog **Set axis to value** opens directly.

### Example: spindle and feed dialogs (circular gauge)

- `SliderControl` on **Home** and **Program** (preview column footer, next to tool info):
  - Click on the **entire** spindle or feed circular area (optional `onClick`), when set:
    - `eventBus.publish('ui.spindle.openDialog', { source: 'sliderControl' })` or
    - `eventBus.publish('ui.feed.openDialog', { source: 'sliderControl' })`.
- Global host `SpindleFeedDialogsHost` (in `App.tsx` next to `CoordinatesDialogHost`):
  - Subscribes to both events and opens the respective dialogs (`SpindleFeedDialogsHost.tsx`).
  - Inside the dialogs: `sendCommand` for `program.mdi` (lines `S…` / `F…`) and `machine.spindle_override` / `machine.feed_override` / `machine.rapid_override` — see [`docs/commands-events.md`](commands-events.md).

### Example: virtual sidebar — cycle start, pause, stop

In `VirtualButtonSidebar` (left column), among others these keys are wired through the event bus; translation to WebSocket commands happens in root hooks:

| Key (position) | Event | WebSocket (target) |
|----------------|-------|---------------------|
| Cycle Start (3) | `ui.program.cycleStart` | `program.auto` with `{ command: 'resume' }` when the interpreter is paused (`program.paused` or `program.interp_state === INTERP_PAUSED`), else `{ command: 'run', startLine: programEditor.pendingAutoRunStartLine }` (after `run` the store flag is reset to `0`) |
| Pause (14) | `ui.program.pause` | `program.auto`: **toggle** — `{ command: 'resume' }` when paused, else `{ command: 'pause' }` (`AUTO_RESUME` / `AUTO_PAUSE`) |
| Stop (15) | `ui.program.stop` | `machine.abort` — `command.abort()` (deliberately a **program** event name, **machine** command; see [`docs/commands-events.md`](commands-events.md)) |
| Flood coolant (9) | `ui.flood.toggle` | `machine.flood` with `{ on: true|false }` — toggles flood coolant (`FLOOD_ON` / `FLOOD_OFF`); only when `task_state === STATE_ON` (gmoccapy `on_tbtn_flood_toggled`). Source: `virtualSidebar`, `hotkey`, or `hal` via `dispatchVirtualSidebarButton`. |
| Spindle left (10) | `ui.spindle.direction` | `machine.spindle` with `{ direction: 'reverse' }` |
| Spindle stop (11) | `ui.spindle.direction` | `machine.spindle` with `{ direction: 'stop' }` |
| Spindle right (12) | `ui.spindle.direction` | `machine.spindle` with `{ direction: 'forward' }` |
| HAL softkey (14, 15, 16) | `ui.hal.softkey` | `hal.softkey_pulse` with `{ slot: 14|15|16 }` — pulses oneshot trigger pin (see [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md)). |

- `useMachineEventBridge` subscribes to `ui.machine.toggle`, `ui.estop.toggle`, `ui.flood.toggle`, `ui.spindle.direction`, `ui.hal.softkey`, and feed/spindle override presets (`ui.feed.setOverride` / `ui.spindle.setOverride`). Feed preset **0 %** requests program pause while AUTO is running (ownership only after status confirms pause; leaving 0 may defer resume until then); otherwise clamps to ~1 %. While at feed **0 %** (pause-ownership, last accepted preset ≤ 0 %, or status ~1 % before any preset), presets **> 100 %** are ignored in `applyFeedOverridePreset` (encoder wrap). Spindle **0 %** clamps to ~1 %. See [`18_OVERRIDE_PRESET_HOTKEYS.md`](features/18_OVERRIDE_PRESET_HOTKEYS.md).
- `useProgramExecutionEventBridge` subscribes to `ui.program.cycleStart`, `ui.program.pause`, and `ui.program.stop`.

### Example: external panel HAL inputs

When [`lcncgui-panel.hal`](../resources/linuxcnc-config/lcncgui-panel.hal) is loaded and panel polling is enabled (`LCNCGUI_PANEL_HAL_ENABLED=1`), the backend polls debounced trigger pins. On a rising edge:

- **GUI WebSocket connected:** backend broadcasts `machine_event` → `panel.sidebar.trigger` with `{ buttonId: 1..16 }`. `useBackendWebSocket` calls `dispatchVirtualSidebarButton(buttonId, 'hal')` in [`src/lib/dispatchVirtualSidebarButton.ts`](../src/lib/dispatchVirtualSidebarButton.ts) — the same event-bus path as sidebar click / hotkey (including `pendingAutoRunStartLine` for cycle start).
- **No GUI client:** machine/program actions run directly in the backend (`backend/panel/sidebar_actions.py`); UI dialog buttons (2, 5–7) are ignored. Headless cycle start always uses `startLine: 0`.

Shared dispatch for sidebar, hotkeys, and HAL (GUI path): `dispatchVirtualSidebarButton` (used by `useVirtualSidebarActions`, hotkey listener, and WebSocket handler). See [`docs/features/15_PANEL_HAL_INPUTS.md`](features/15_PANEL_HAL_INPUTS.md).

### Example: macros — generate queue program

- `MacrosScreen` (`src/screens/MacrosScreen.tsx`):
  - The **Go to program** button only fires `eventBus.publish('ui.macros.generateProgram', { source: 'macrosScreen' })`.
- `useMacroQueueProgramGeneration` (`src/hooks/useMacroQueueProgramGeneration.ts`):
  - Subscribes to `ui.macros.generateProgram`.
  - Runs queue pipeline: `program.list` → `program.write` → `program.open` → `program.read`.
  - On success, switches to Program screen; on failure, shows toasts / editor error state.

### Convention for button implementation

**Do:**

```tsx
import { eventBus } from '@/eventBus';

function StartButton() {
  return (
    <Button
      onClick={() =>
        eventBus.publish('program.run', {
          source: 'toolbar',
          programId: 'current',
        })
      }
    >
      Start
    </Button>
  );
}
```

**Don’t:**

- Call `sendCommand(...)` directly from a button.
- Put complex logic in `onClick`.
- Scatter backend-specific details (e.g. categories/actions) across UI components.

**Exception (modal dialogs):** In **dialogs** that only bundle backend commands (e.g. `CoordinateSystemsDialog`, spindle/feed dialogs in `SpindleFeedDialogsHost`), primary actions may use `sendCommand` directly. **Opening** those dialogs still goes through the event bus from a slim trigger (coordinates display, `SliderControl`), as in the coordinates example above.

### Listener layers

- **Command handlers**
  - Attach to the event bus and translate UI events into backend commands (`sendCommand`).
  - Example: for `jog.move`, `useJogCommand` maps to `motion.jog`; for `jog.stop`, `useJogStopCommand` maps to `motion.jog_stop`.
- **Logging / telemetry**
  - Separate listeners or a central logging layer log relevant events (e.g. to console, telemetry endpoint, local dev view).
  - Currently `eventBus.publish` optionally logs to the browser console when debug mode is enabled in Settings.
  - Usage data can be collected without touching UI code.

### Example: jog flow (reference)

The concrete jog button behavior is described in `docs/frontend-eventbus-jog.md`. Summary:

- `DirectionalControl` fires `eventBus.publish('jog.move', { axis, direction })` in incremental mode.
- In continuous mode, `DirectionalControl` fires `jog.move` on pointer down and `jog.stop` on pointer up/cancel.
- A subscription hook (e.g. `useJogEventSubscription` in `useJogCommand.ts`) subscribes to `jog.move`/`jog.stop`,
  calls `useJogCommand`/`useJogStopCommand` internally, and sends `motion.jog`/`motion.jog_stop` to the backend.
- Debug logging of event bus events (including `jog.move` and `jog.stop`) is centralized in `eventBus.publish`
  when debug mode is enabled in the GUI.

### How to add new events

1. **Define the event**
   - Add an entry to `FrontendEventMap` in `src/eventBus.ts`.
   - Use names in the `domain.action` schema (e.g. `program.run`, `machine.set_mode`, `ui.dialog.open`).
2. **Adjust the button**
   - In the button `onClick`, only use `eventBus.publish('<event-name>', payload)`.
3. **Implement a listener**
   - Either:
     - a dedicated hook with `useEffect` + `eventBus.subscribe(...)` wired in `App` or a screen, or
     - a service module initialized at app start.
4. **Optional: add a logging listener**
   - Add a second listener for the same event that collects data for debug/analytics.

### Target picture

Long term, **all interactive UI actions** (buttons, possibly shortcuts) should be modeled through the event bus. That yields:

- consistent UI,
- simpler logging/telemetry,
- clearer decoupling between UI and backend details.

