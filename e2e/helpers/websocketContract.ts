import type { Page, WebSocket } from 'playwright';
import { expect } from '../fixtures/webTest';

type AnyObject = Record<string, unknown>;

export interface CapturedStatusFrame {
  message: AnyObject;
  receivedAt: number;
}

const ENVELOPE_KEYS = ['type', 'protocolVersion', 'event', 'payload'] as const;
const PAYLOAD_REQUIRED_KEYS = [
  'machine',
  'motion',
  'io',
  'program',
  'overrides',
  'spindle',
  'joints',
  'axes',
  'tools',
] as const;
const PAYLOAD_OPTIONAL_KEYS = ['coordinate_systems'] as const;

function isPlainObject(value: unknown): value is AnyObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoUnknownKeys(target: AnyObject, allowedKeys: readonly string[], pathName: string): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(target).filter((key) => !allowed.has(key));
  expect(unknown, `${pathName} has unknown keys: ${unknown.join(', ') || 'none'}`).toEqual([]);
}

function assertFiniteNumberArray(value: unknown, pathName: string): void {
  expect(Array.isArray(value), `${pathName} must be an array`).toBe(true);
  for (const [idx, entry] of (value as unknown[]).entries()) {
    expect(typeof entry, `${pathName}[${idx}] must be a number`).toBe('number');
    expect(Number.isFinite(entry), `${pathName}[${idx}] must be finite`).toBe(true);
  }
}

export function validateLinuxCncStatusEnvelopeStrict(raw: unknown): void {
  expect(isPlainObject(raw), 'message must be a JSON object').toBe(true);
  const message = raw as AnyObject;

  assertNoUnknownKeys(message, ENVELOPE_KEYS, 'message');
  expect(message.type, 'message.type must equal "linuxcnc_status"').toBe('linuxcnc_status');
  expect(message.protocolVersion, 'message.protocolVersion must equal 1').toBe(1);
  expect(message.event, 'message.event must equal "status.snapshot"').toBe('status.snapshot');
  expect(isPlainObject(message.payload), 'message.payload must be an object').toBe(true);

  const payload = message.payload as AnyObject;
  assertNoUnknownKeys(payload, [...PAYLOAD_REQUIRED_KEYS, ...PAYLOAD_OPTIONAL_KEYS], 'message.payload');

  for (const required of PAYLOAD_REQUIRED_KEYS) {
    expect(required in payload, `message.payload.${required} is required`).toBe(true);
  }

  expect(isPlainObject(payload.machine), 'message.payload.machine must be an object').toBe(true);
  if ((payload.machine as AnyObject).task_state !== undefined && (payload.machine as AnyObject).task_state !== null) {
    expect(typeof (payload.machine as AnyObject).task_state, 'message.payload.machine.task_state must be number|null').toBe('number');
  }
  if ((payload.machine as AnyObject).task_mode !== undefined && (payload.machine as AnyObject).task_mode !== null) {
    expect(typeof (payload.machine as AnyObject).task_mode, 'message.payload.machine.task_mode must be number|null').toBe('number');
  }

  expect(isPlainObject(payload.motion), 'message.payload.motion must be an object').toBe(true);
  if ((payload.motion as AnyObject).actual_position !== undefined) {
    assertFiniteNumberArray((payload.motion as AnyObject).actual_position, 'message.payload.motion.actual_position');
  }

  expect(isPlainObject(payload.io), 'message.payload.io must be an object').toBe(true);
  expect(isPlainObject(payload.program), 'message.payload.program must be an object').toBe(true);
  expect(isPlainObject(payload.overrides), 'message.payload.overrides must be an object').toBe(true);
  expect(isPlainObject(payload.tools), 'message.payload.tools must be an object').toBe(true);

  if ((payload.tools as AnyObject).tool_in_spindle !== undefined) {
    expect(typeof (payload.tools as AnyObject).tool_in_spindle, 'message.payload.tools.tool_in_spindle must be number').toBe('number');
  }

  expect(Array.isArray(payload.spindle), 'message.payload.spindle must be an array').toBe(true);
  for (const [idx, entry] of (payload.spindle as unknown[]).entries()) {
    expect(isPlainObject(entry), `message.payload.spindle[${idx}] must be an object`).toBe(true);
    const spindle = entry as AnyObject;
    if (spindle.override_enabled !== undefined) {
      expect(typeof spindle.override_enabled, `message.payload.spindle[${idx}].override_enabled must be boolean`).toBe('boolean');
    }
    if (spindle.speed !== undefined) {
      expect(typeof spindle.speed, `message.payload.spindle[${idx}].speed must be number`).toBe('number');
    }
  }

  expect(Array.isArray(payload.joints), 'message.payload.joints must be an array').toBe(true);
  for (const [idx, entry] of (payload.joints as unknown[]).entries()) {
    expect(isPlainObject(entry), `message.payload.joints[${idx}] must be an object`).toBe(true);
  }

  expect(Array.isArray(payload.axes), 'message.payload.axes must be an array').toBe(true);
  for (const [idx, entry] of (payload.axes as unknown[]).entries()) {
    expect(isPlainObject(entry), `message.payload.axes[${idx}] must be an object`).toBe(true);
  }

  if (payload.coordinate_systems !== undefined) {
    expect(Array.isArray(payload.coordinate_systems), 'message.payload.coordinate_systems must be an array').toBe(true);
    for (const [idx, entry] of (payload.coordinate_systems as unknown[]).entries()) {
      expect(isPlainObject(entry), `message.payload.coordinate_systems[${idx}] must be an object`).toBe(true);
    }
  }
}

export async function captureLinuxCncStatusFrames(
  page: Page,
  count: number,
  timeoutMs: number,
): Promise<CapturedStatusFrame[]> {
  return new Promise<CapturedStatusFrame[]>((resolve, reject) => {
    const frames: CapturedStatusFrame[] = [];
    const teardown: Array<() => void> = [];
    let settled = false;

    const finish = (result: { ok: true; value: CapturedStatusFrame[] } | { ok: false; error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      for (const stop of teardown) stop();
      if (result.ok) {
        resolve(result.value);
      } else {
        reject(result.error);
      }
    };

    const onPageWebSocket = (ws: WebSocket) => {
      const onFrameReceived = (event: { payload: string | Buffer }) => {
        if (typeof event.payload !== 'string') return;
        try {
          const parsed = JSON.parse(event.payload) as AnyObject;
          if (parsed.type !== 'linuxcnc_status') return;

          frames.push({ message: parsed, receivedAt: Date.now() });
          if (frames.length >= count) {
            finish({ ok: true, value: frames });
          }
        } catch {
          // Ignore non-JSON or non-contract frames.
        }
      };

      ws.on('framereceived', onFrameReceived);
      teardown.push(() => ws.off('framereceived', onFrameReceived));
    };

    page.on('websocket', onPageWebSocket);
    teardown.push(() => page.off('websocket', onPageWebSocket));

    const timeoutId = setTimeout(() => {
      finish({
        ok: false,
        error: new Error(
          `Expected ${count} linuxcnc_status frames within ${timeoutMs}ms, but received ${frames.length}.`,
        ),
      });
    }, timeoutMs);
  });
}

export type IncomingLinuxCncStatusSession = {
  /**
   * Registers a one-shot wait slot and optionally starts `trigger` immediately (e.g. click + outgoing command).
   * Incoming `linuxcnc_status` frames during the window can satisfy the slot — `trigger` runs **in parallel**
   * with the inbound stream, not only after a match.
   */
  waitForLinuxCncStatusPayload(
    options: {
      predicate: (payload: AnyObject) => boolean;
      timeoutMs?: number;
    },
    trigger?: () => Promise<void>,
  ): Promise<CapturedStatusFrame>;
  dispose(): void;
};

/**
 * Listens for incoming `linuxcnc_status` JSON frames via Playwright
 * [`WebSocket`](https://playwright.dev/docs/api/class-websocket) **`framereceived`**
 * (symmetric to outgoing `framesent` in `outgoingWebSocketCommands.ts`).
 *
 * **`page.on('websocket')` only sees new connections** — after creating this session, run
 * `page.reload()` once (or reload the page) so the backend WebSocket is observed. Without reload
 * the existing connection stays invisible (as with `captureLinuxCncStatusFrames`).
 */
function framePayloadToString(payload: string | Buffer): string {
  if (typeof payload === 'string') return payload;
  if (Buffer.isBuffer(payload)) return payload.toString('utf8');
  return '';
}

export async function createIncomingLinuxCncStatusSession(
  page: Page,
): Promise<IncomingLinuxCncStatusSession> {
  let disposed = false;
  let waitSeq = 0;
  type WaitSlot = {
    id: number;
    predicate: (payload: AnyObject) => boolean;
    resolve: (value: CapturedStatusFrame) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };
  let current: WaitSlot | null = null;
  /** For timeout diagnostics: last seen `linuxcnc_status` payload and counter. */
  let lastLinuxCncPayload: AnyObject | null = null;
  let linuxCncStatusSeenWhileWaiting = 0;

  const teardown: Array<() => void> = [];

  const tryHandlePayload = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as AnyObject;
      if (parsed.type !== 'linuxcnc_status') return;
      const pl = parsed.payload;
      if (pl === null || typeof pl !== 'object' || Array.isArray(pl)) return;
      lastLinuxCncPayload = pl as AnyObject;
      if (current) {
        linuxCncStatusSeenWhileWaiting += 1;
        if (!current.predicate(pl as AnyObject)) return;
        clearTimeout(current.timeoutId);
        const slot = current;
        current = null;
        slot.resolve({ message: parsed, receivedAt: Date.now() });
      }
    } catch {
      // ignore
    }
  };

  const onPageWebSocket = (ws: WebSocket) => {
    const onFrameReceived = (event: { payload: string | Buffer }) => {
      const raw = framePayloadToString(event.payload);
      if (!raw) return;
      tryHandlePayload(raw);
    };
    ws.on('framereceived', onFrameReceived);
    teardown.push(() => ws.off('framereceived', onFrameReceived));
  };

  page.on('websocket', onPageWebSocket);
  teardown.push(() => page.off('websocket', onPageWebSocket));

  const waitForLinuxCncStatusPayload = (
    options: {
      predicate: (payload: AnyObject) => boolean;
      timeoutMs?: number;
    },
    trigger?: () => Promise<void>,
  ): Promise<CapturedStatusFrame> => {
    if (disposed) {
      return Promise.reject(new Error('createIncomingLinuxCncStatusSession: already disposed'));
    }
    if (current) {
      return Promise.reject(
        new Error('createIncomingLinuxCncStatusSession: concurrent wait is not supported'),
      );
    }

    const timeoutMs = options.timeoutMs ?? 15_000;
    const id = ++waitSeq;

    return new Promise<CapturedStatusFrame>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (current?.id !== id) return;
        current = null;
        const spindleHint =
          lastLinuxCncPayload?.spindle !== undefined
            ? ` lastPayload.spindle=${JSON.stringify(lastLinuxCncPayload.spindle).slice(0, 400)}`
            : '';
        const ioHint =
          lastLinuxCncPayload?.io !== undefined
            ? ` lastPayload.io=${JSON.stringify(lastLinuxCncPayload.io).slice(0, 200)}`
            : '';
        reject(
          new Error(
            `Expected linuxcnc_status payload within ${timeoutMs}ms (Playwright WebSocket framereceived).` +
              ` linuxcnc_status frames while waiting: ${linuxCncStatusSeenWhileWaiting}.${spindleHint}${ioHint}`,
          ),
        );
      }, timeoutMs);

      current = {
        id,
        predicate: options.predicate,
        resolve,
        reject,
        timeoutId,
      };
      linuxCncStatusSeenWhileWaiting = 0;

      const run = async () => {
        try {
          if (trigger) await trigger();
        } catch (err: unknown) {
          if (current?.id !== id) return;
          clearTimeout(timeoutId);
          current = null;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      void run();
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (current) {
      clearTimeout(current.timeoutId);
      current.reject(new Error('createIncomingLinuxCncStatusSession: disposed'));
      current = null;
    }
    for (const stop of teardown) stop();
    teardown.length = 0;
  };

  return { waitForLinuxCncStatusPayload, dispose };
}
