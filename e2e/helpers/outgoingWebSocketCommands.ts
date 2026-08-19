import type { CDPSession, Page, WebSocket } from 'playwright';


type AnyObject = Record<string, unknown>;

/** Minimal shape of `docs/commands-events.md` command envelopes (after JSON parse). */
export type OutgoingCommandEnvelope = {
  type: 'command';
  commandId?: string;
  category: string;
  action: string;
  params?: Record<string, unknown>;
};

function isCommandEnvelope(raw: AnyObject): raw is OutgoingCommandEnvelope {
  return raw.type === 'command' && typeof raw.category === 'string' && typeof raw.action === 'string';
}

export interface CapturedOutgoingCommand {
  message: OutgoingCommandEnvelope;
  sentAt: number;
}

function tryParseCommandFromPayload(raw: string): OutgoingCommandEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as AnyObject;
    if (!isCommandEnvelope(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** CDP `Network.webSocketFrameSent` — payload shape varies by Chromium/Electron build. */
function extractWebSocketSentPayload(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const e = event as Record<string, unknown>;
  const response = e.response;
  if (response && typeof response === 'object' && response !== null) {
    const pd = (response as { payloadData?: unknown }).payloadData;
    if (typeof pd === 'string') return pd;
  }
  if (typeof e.payloadData === 'string') return e.payloadData;
  return undefined;
}

export type OutgoingCommandSession = {
  waitForOutgoingCommand(
    options: {
      predicate: (msg: OutgoingCommandEnvelope) => boolean;
      timeoutMs?: number;
    },
    trigger: () => Promise<void>,
  ): Promise<CapturedOutgoingCommand>;
  dispose(): void;
};

type WaitSlot = {
  id: number;
  predicate: (msg: OutgoingCommandEnvelope) => boolean;
  resolve: (value: CapturedOutgoingCommand) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

/**
 * One CDP session + listener for several consecutive `waitForOutgoingCommand` calls
 * (without reconnecting each step).
 */
export async function createOutgoingCommandSession(page: Page): Promise<OutgoingCommandSession> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  const teardown: Array<() => void> = [];
  let disposed = false;
  let waitSeq = 0;
  let current: WaitSlot | null = null;

  const tryHandlePayload = (raw: string) => {
    if (!current) return;
    const msg = tryParseCommandFromPayload(raw);
    if (!msg || !current.predicate(msg)) return;
    clearTimeout(current.timeoutId);
    const slot = current;
    current = null;
    slot.resolve({ message: msg, sentAt: Date.now() });
  };

  const onCdpFrameSent = (event: unknown) => {
    const payloadData = extractWebSocketSentPayload(event);
    if (typeof payloadData !== 'string') return;
    tryHandlePayload(payloadData);
  };

  cdp.on('Network.webSocketFrameSent', onCdpFrameSent);

  const onFrameSent = () => (event: { payload: string | Buffer }) => {
    if (typeof event.payload !== 'string') return;
    tryHandlePayload(event.payload);
  };

  const onPageWebSocket = (ws: WebSocket) => {
    const handler = onFrameSent();
    ws.on('framesent', handler);
    teardown.push(() => ws.off('framesent', handler));
  };

  page.on('websocket', onPageWebSocket);
  teardown.push(() => page.off('websocket', onPageWebSocket));

  const waitForOutgoingCommand = (
    options: {
      predicate: (msg: OutgoingCommandEnvelope) => boolean;
      timeoutMs?: number;
    },
    trigger: () => Promise<void>,
  ): Promise<CapturedOutgoingCommand> => {
    if (disposed) {
      return Promise.reject(new Error('createOutgoingCommandSession: already disposed'));
    }
    if (current) {
      return Promise.reject(
        new Error('createOutgoingCommandSession: concurrent waitForOutgoingCommand is not supported'),
      );
    }

    const timeoutMs = options.timeoutMs ?? 15_000;
    const id = ++waitSeq;

    return new Promise<CapturedOutgoingCommand>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (current?.id !== id) return;
        current = null;
        reject(
          new Error(
            `Expected outgoing command within ${timeoutMs}ms (CDP Network.webSocketFrameSent / framesent).`,
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

      void trigger().catch((err: unknown) => {
        if (current?.id !== id) return;
        clearTimeout(current.timeoutId);
        current = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (current) {
      clearTimeout(current.timeoutId);
      current.reject(new Error('createOutgoingCommandSession: disposed'));
      current = null;
    }
    for (const stop of teardown) stop();
    teardown.length = 0;
    void cdp.detach().catch(() => {
      // ignore
    });
  };

  return { waitForOutgoingCommand, dispose };
}

/**
 * One-shot wait (one CDP session, then closed).
 * For multiple steps prefer `createOutgoingCommandSession`.
 */
export async function waitForOutgoingCommand(
  page: Page,
  options: {
    predicate: (msg: OutgoingCommandEnvelope) => boolean;
    timeoutMs?: number;
  },
  trigger: () => Promise<void>,
): Promise<CapturedOutgoingCommand> {
  const session = await createOutgoingCommandSession(page);
  try {
    return await session.waitForOutgoingCommand(options, trigger);
  } finally {
    session.dispose();
  }
}

/** Predicate builder: `category` + `action` must match exactly. */
export function matchCommandCategoryAction(
  category: string,
  action: string,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => msg.category === category && msg.action === action;
}

export function matchMachineSetTaskState(msg: OutgoingCommandEnvelope): boolean {
  return msg.category === 'machine' && msg.action === 'set_task_state';
}

export function matchMachineSetTaskStateWithStatus(
  status: number,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => {
    if (!matchMachineSetTaskState(msg)) return false;
    return (msg.params?.status as number | undefined) === status;
  };
}

export function matchMachineSpindle(
  direction: 'forward' | 'reverse' | 'stop',
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => {
    if (msg.category !== 'machine' || msg.action !== 'spindle') return false;
    if (msg.params?.direction !== direction) return false;
    if (direction === 'stop') return true;
    // Forward/reverse without `speed` so LinuxCNC uses programmed S RPM.
    const speed = (msg.params as Record<string, unknown> | undefined)?.speed;
    return speed === undefined || speed === null;
  };
}

export function matchMachineFlood(on: boolean): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) =>
    msg.category === 'machine' && msg.action === 'flood' && msg.params?.on === on;
}

export function matchProgramMdiWithText(
  text: string,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) =>
    msg.category === 'program' && msg.action === 'mdi' && msg.params?.text === text;
}

export function matchProgramLoadToolTable(): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => msg.category === 'program' && msg.action === 'load_tool_table';
}

/** `program.read` — optional `pathSubstring` must appear in `params.path`. */
export function matchProgramRead(pathSubstring?: string): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => {
    if (msg.category !== 'program' || msg.action !== 'read') return false;
    if (pathSubstring === undefined) return true;
    const p = msg.params?.path;
    return typeof p === 'string' && p.includes(pathSubstring);
  };
}

export function matchToolAddRow(
  toolno?: number,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => {
    if (msg.category !== 'tool' || msg.action !== 'add_tool_table_row') return false;
    if (toolno === undefined) return true;
    return (msg.params?.toolno as number | undefined) === toolno;
  };
}

export function matchToolUpdateRow(
  toolno?: number,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => {
    if (msg.category !== 'tool' || msg.action !== 'update_tool_table_row') return false;
    if (toolno === undefined) return true;
    return (msg.params?.toolno as number | undefined) === toolno;
  };
}

export function matchToolDeleteRow(
  toolno?: number,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) => {
    if (msg.category !== 'tool' || msg.action !== 'delete_tool_table_row') return false;
    if (toolno === undefined) return true;
    return (msg.params?.toolno as number | undefined) === toolno;
  };
}

export function matchToolTouchOff(
  axis: string,
  value: number,
): (msg: OutgoingCommandEnvelope) => boolean {
  return (msg) =>
    msg.category === 'tool' &&
    msg.action === 'touch_off' &&
    msg.params?.axis === axis &&
    msg.params?.value === value;
}

export type OutgoingWebSocketTap = {
  /** Current count of captured outgoing `command` envelopes. */
  readonly commandCount: number;
  dispose(): void;
  /**
   * Waits for the next outgoing command **after** the current `commandCount` at call time
   * that satisfies `predicate`. Call **before** the UI action that triggers the send, then
   * `await` after the click (same pattern as `waitForOutgoingCommand`).
   */
  waitForNextOutgoingCommand(
    predicate: (msg: OutgoingCommandEnvelope) => boolean,
    options?: { timeoutMs?: number },
  ): Promise<CapturedOutgoingCommand>;
  /**
   * After an action (e.g. click), poll until `timeoutMs` and fail as soon as any command
   * captured **since** `sinceIndex` matches `predicate` (catches delayed sends).
   */
  assertNoOutgoingCommandSince(
    sinceIndex: number,
    predicate: (msg: OutgoingCommandEnvelope) => boolean,
    options?: { timeoutMs?: number; pollMs?: number },
  ): Promise<void>;
};

function pushCommand(commands: CapturedOutgoingCommand[], raw: string): void {
  try {
    const parsed = JSON.parse(raw) as AnyObject;
    if (!isCommandEnvelope(parsed)) return;
    commands.push({ message: parsed, sentAt: Date.now() });
  } catch {
    // ignore non-JSON
  }
}

/**
 * Collects outgoing `type: "command"` frames (CDP `Network.webSocketFrameSent` + `framesent`).
 * Allows several commands in sequence on the same connection.
 *
 * Register listener first; for a new handshake often use `page.reload()` so
 * `page.on('websocket')` sees the connection (see `sidebar-navigation.spec.ts`).
 */
export function attachOutgoingWebSocketTap(page: Page): OutgoingWebSocketTap {
  const commands: CapturedOutgoingCommand[] = [];
  const teardown: Array<() => void> = [];
  /** Same text frame may arrive via CDP and `framesent` — count once. */
  const seenRawPayloads = new Set<string>();

  let disposed = false;

  const appendFromRaw = (raw: string): void => {
    if (seenRawPayloads.has(raw)) return;
    seenRawPayloads.add(raw);
    pushCommand(commands, raw);
  };

  void page
    .context()
    .newCDPSession(page)
    .then(async (cdp) => {
      if (disposed) {
        await cdp.detach();
        return;
      }
      await cdp.send('Network.enable');
      const onCdpSent = (event: unknown) => {
        const pd = extractWebSocketSentPayload(event);
        if (typeof pd === 'string') appendFromRaw(pd);
      };
      cdp.on('Network.webSocketFrameSent', onCdpSent);
      teardown.push(() => {
        cdp.off('Network.webSocketFrameSent', onCdpSent);
        void cdp.detach();
      });
    })
    .catch(() => {
      // CDP optional; framesent fallback remains
    });

  const onFrameSent = (event: { payload: string | Buffer }) => {
    if (typeof event.payload !== 'string') return;
    appendFromRaw(event.payload);
  };

  const onPageWebSocket = (ws: WebSocket) => {
    ws.on('framesent', onFrameSent);
    teardown.push(() => ws.off('framesent', onFrameSent));
  };

  page.on('websocket', onPageWebSocket);
  teardown.push(() => page.off('websocket', onPageWebSocket));

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const stop of teardown) stop();
    teardown.length = 0;
  };

  const waitForNextOutgoingCommand = async (
    predicate: (msg: OutgoingCommandEnvelope) => boolean,
    options?: { timeoutMs?: number },
  ): Promise<CapturedOutgoingCommand> => {
    const timeoutMs = options?.timeoutMs ?? 15_000;
    const startLen = commands.length;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (let i = startLen; i < commands.length; i += 1) {
        if (predicate(commands[i].message)) {
          return commands[i];
        }
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
    }

    throw new Error(
      `Expected outgoing command after index ${startLen} within ${timeoutMs}ms (got ${
        commands.length - startLen
      } new command frame(s), total ${commands.length}).`,
    );
  };

  const assertNoOutgoingCommandSince = async (
    sinceIndex: number,
    predicate: (msg: OutgoingCommandEnvelope) => boolean,
    options?: { timeoutMs?: number; pollMs?: number },
  ): Promise<void> => {
    const timeoutMs = options?.timeoutMs ?? 1_000;
    const pollMs = options?.pollMs ?? 25;
    const deadline = Date.now() + timeoutMs;

    const checkNewCommands = (): void => {
      for (let i = sinceIndex; i < commands.length; i += 1) {
        if (predicate(commands[i].message)) {
          throw new Error(
            `Unexpected outgoing command at index ${i}: ${JSON.stringify(commands[i].message)}`,
          );
        }
      }
    };

    while (Date.now() < deadline) {
      checkNewCommands();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, pollMs);
      });
    }
    checkNewCommands();
  };

  return {
    get commandCount() {
      return commands.length;
    },
    dispose,
    waitForNextOutgoingCommand,
    assertNoOutgoingCommandSince,
  };
}
