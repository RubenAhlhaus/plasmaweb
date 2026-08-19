# WebSocket tests (frontend)

> For GUI end-to-end tests (browser + Playwright) see also `docs/test/e2e-tests.md`.

Short overview of the main frontend tests around the WebSocket interface.  
Goal: quickly see **what** each test covers and whether a given aspect is covered.

## `src/api/__tests__/backendCommands.test.ts`

- **`createCommandEnvelope` – minimal envelope without params/commandId**  
  Asserts that for category + action a valid `CommandEnvelope` with `type: "command"` is produced even when no params/`commandId` are passed.

- **`createCommandEnvelope` – with params**  
  Ensures passed parameters land in the `params` field of the envelope.

- **`createCommandEnvelope` – with commandId**  
  Asserts an optional `commandId` is copied into the envelope correctly.

- **`createCommandEnvelope` – with params and commandId**  
  Tests the combination of category, action, params, and `commandId` and asserts the JSON matches the expected schema.

## `src/api/__tests__/statusMapping.test.ts`

- **`mapTaskStateStringToEnum` – known values**  
  Verifies strings like `"STATE_ON"`, `"STATE_ESTOP"`, etc. map to the correct `TaskState` enum values.

- **`mapTaskStateStringToEnum` – unknown values**  
  Ensures unknown strings become `undefined` so no task state is forced.

- **`mapStatusMessageToStoreUpdates` – task state mapping in machine status**  
  Asserts `machine.task_state` as string is converted to a `TaskState` enum and other fields in the `machine` block stay unchanged.

- **`mapStatusMessageToStoreUpdates` – coordinates from motion.actual_position**  
  Tests that from `motion.actual_position` together with raw offsets **`g5x_offset`**, **`g92_offset`**, and **`tool_offset`** (G43) a new `Coordinates` object is built and only axes actually present in the message are overwritten (other axes keep previous values). Additionally: separate test that `tool_offset` after tool touch-off adjusts Z display correctly.

- **`mapStatusMessageToStoreUpdates` – fallback to previous motion status**  
  Ensures when `motion` is missing in the inbound status, the previous `linuxCncStatus.motion` from the store is used to derive coordinates.

- **`mapStatusMessageToStoreUpdates` – connection status**  
  Asserts that on every valid `linuxcnc_status` update the returned `connectionStatus` is set to `"connected"`.

## `src/hooks/__tests__/useBackendWebSocket.test.tsx`

- **Connection setup & URL**  
  The app reads the WebSocket URL from `lcncgui-config.json` (see [`docs/frontend-web-start.md`](../frontend-web-start.md)) and writes it to the store (`backendWebSocketUrl`). Hook `useBackendWebSocket` connects only when that URL is set.  
  In tests `beforeEach` sets `useAppStore.getState().setBackendWebSocketUrl('ws://127.0.0.1:8765/ws')` (matches default repo config). On mount the hook must pass exactly this URL to `MockWebSocket`.

- **`connectionStatus` & `backendWebSocket` on `onopen`**  
  Asserts that on `onopen` store status becomes `"connected"` and the current WebSocket handle is registered (`backendWebSocket`).

- **Status update (`linuxcnc_status`) → store & coordinates**  
  Simulates a status message with `machine.task_state` as string and `motion.actual_position` and asserts:
  - `linuxCncStatus.machine.task_state` in the store has the expected enum value and
  - `coordinates` in the store has the expected axis values (e.g. `x`, `y`, `z`) **after** advancing fake timers by `COORDINATE_UI_FLUSH_MS` (coordinate batcher).

- **`motion.coordinates.changed` → coordinates**  
  Same timer advance required before asserting `coordinates` in the store (see `src/lib/coordinateUpdateBatcher.ts`).

- **Disconnect (`onclose`)**  
  Ensures on `onclose` `connectionStatus` becomes `"disconnected"` and `backendWebSocket` in the store is cleared.

## `src/lib/__tests__/loadLcncguiConfig.test.ts`

- **`parseLcncguiConfigJson`** — valid minimal JSON (`websocketUrl` only), default `ui` values, trim/`wss`, **`websocketUrl: "auto"`** (resolves to `ws://` or `wss://` + `window.location.host` + `/ws`), partial `ui`, schema errors (not an object, missing URL, empty string, wrong URL scheme / non-`auto`), ignoring non-boolean `ui` fields.

## `useSendCommand` (hook)

There is currently no dedicated hook test file for `useSendCommand`. `CommandEnvelope` serialization is covered in `src/api/__tests__/backendCommands.test.ts` via `createCommandEnvelope`.

## `src/hooks/__tests__/usePendingWsCommandResult.test.tsx`

- **`usePendingWsCommandResult`** — fires `onResult` when `commandResultHistory` gains a matching `commandId`; respects `enabled: false`; deduplicates on further history updates.
- **`usePendingWsCommandResults`** / **`usePendingWsCommandResultMap`** — resolve pending Set/Map entries.
- **`useWsCommandResultHistoryEffect`** — runs a callback whenever the history changes.

## `src/lib/__tests__/waitForWsCommandResult.test.ts`

- **`waitForWsCommandResult`** — resolves from `commandResultHistory`, returns error payloads, rejects on timeout.

## `src/hooks/__tests__/useMacroQueueProgramGeneration.test.tsx`

- **Event-bus start** — publishes `ui.macros.generateProgram` and asserts the first outbound `program.list` command.

---

When you add new tests for the WebSocket interface, please extend this file briefly with:

- the **file path** of the test and
- for each `it` block, 1–2 sentences on **what** is checked.

That makes it easy later to see whether a path (e.g. a specific command or status-mapping edge case) is already covered.

## `e2e/tests/websocket-contract.spec.ts`

- **Strict contract test for `linuxcnc_status` in live E2E**  
  Uses the running shared browser session, listens to real inbound WebSocket frames (`framereceived`), and waits for periodic `linuxcnc_status` messages.

- **Schema validation without extra library**  
  Validates envelope and `payload` strictly (required fields + central type checks + unknown-key detection on top level) so unintended backend format changes fail fast.

- **Periodicity is explicitly asserted**  
  The test expects two consecutive status frames within the timeout and thus checks not only the initial snapshot but the ongoing stream.
