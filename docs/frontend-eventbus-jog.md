## Frontend event bus for jog buttons

This event bus decouples the jog UI (buttons) from the actual command logic (`motion.jog`) and allows multiple subscribers per event (e.g. logging, telemetry).

### Event types

- **Event name**: `jog.move`
- **Payload** (same as `UiJogRequest` in `src/api/jogTypes.ts`):

```ts
type JogAxis = 'x' | 'y' | 'z';
type JogDirection = 'positive' | 'negative';

type JogMovePayload = {
  axis: JogAxis;
  direction: JogDirection;
};

type UnhomedJogConfirmPayload = JogMovePayload;
```

Additionally:

- **Event name**: `jog.stop`
- **Payload**:

```ts
type JogStopPayload = {
  axis: JogAxis;
};
```

- **Event name**: `ui.unhomed_jog.confirm`
- **Payload**:

```ts
type UnhomedJogConfirmPayload = {
  axis: JogAxis;
  direction: JogDirection;
};
```

This event is used by the jog command handler (`useJogCommand`) to open a hint dialog when an axis is not yet homed before jogging in joint mode.

### Event bus API

- File: `src/eventBus.ts`
- The **full** `FrontendEventMap` contains many more UI events (homing, machine, coordinates, program, …). Below is only the **jog-related excerpt**; the authoritative definition is `src/eventBus.ts`.
- Exported API (excerpt):

```ts
// Excerpt — full map see src/eventBus.ts
type FrontendEventMap = {
  'jog.move': JogMovePayload;
  'jog.stop': JogStopPayload;
  'ui.unhomed_jog.confirm': UnhomedJogConfirmPayload;
};

eventBus.subscribe('jog.move', (payload) => { ... });
eventBus.publish('jog.move', payload);

eventBus.subscribe('jog.stop', (payload) => { ... });
eventBus.publish('jog.stop', payload);

eventBus.subscribe('ui.unhomed_jog.confirm', (payload) => { ... });
eventBus.publish('ui.unhomed_jog.confirm', payload);
```

### Jog button data flow

1. UI interaction on a jog button in `DirectionalControl`:
   - **Incremental mode**: the component fires `eventBus.publish('jog.move', { axis, direction })` on click.
   - **Continuous mode**:
     - Pointer down (primary button only) → `eventBus.publish('jog.move', { axis, direction })`
     - Pointer up / pointer cancel → `eventBus.publish('jog.stop', { axis })`
     - In continuous mode only: `contextmenu` is suppressed and direction buttons use `touch-action: none` / no touch callout so a held press keeps jogging (no right-click-style menu on touch panels).
   - Buttons fire events only when frontend jog preconditions are met (machine ON, no E-stop, manual mode). Otherwise they are disabled and a tooltip explains why.
2. **`useJogEventSubscription`** (invoked from `App.tsx`) subscribes to `jog.move` and `jog.stop` and internally uses callbacks from **`useJogCommand`** / **`useJogStopCommand`** (`src/hooks/useJogCommand.ts`):
   - `jog.move` → `useJogCommand`:
     - Axis **homed** → `motion.jog` in axis mode (`jointMode: false`).
     - Axis **not homed**, hint dialog for this axis **not** yet shown → **no** `motion.jog`; instead `eventBus.publish('ui.unhomed_jog.confirm', payload)`; `UnhomedAxisJogDialog` reacts to that.
     - Axis **not homed**, dialog already confirmed → `motion.jog` in joint mode (`jointMode: true`).
   - After the dialog is confirmed, it marks the axis in the UI store and fires `jog.move` again with the same payload; the next `useJogCommand` pass then uses joint mode (see last point above).
   - `jog.stop` → `useJogStopCommand` → `motion.jog_stop` (only meaningful in continuous mode; if unhomed routing is still blocked, nothing is sent).
3. For robustness, `DirectionalControl` also sends `jog.stop` for all currently held continuous axes on window blur, tab change (`visibilitychange`), and unmount.
4. Debug logging for `jog.move`/`jog.stop` is centralized in the event bus (`eventBus.publish`) when debug mode is enabled in Settings; then the event is printed to the developer console with a timestamp.
5. Further listeners may also subscribe to `jog.move`/`jog.stop` (e.g. telemetry).

### Extension

- Further UI actions can be added similarly as events in `FrontendEventMap`, e.g.:
  - `program.run`
  - `machine.set_mode`
  - `ui.dialog.open`

### Debug mode / logging

- The Settings screen of the GUI can enable a debug mode for logging.
- When active:
  - all events that go through the frontend event bus are logged with a timestamp in the browser console,
  - additionally, inbound and outbound WebSocket messages (`useSendCommand` / `useBackendWebSocket`) are printed with `[debug][ws][out]` / `[debug][ws][in]` and a timestamp.
- Logging is for the current session only and is not persisted.

