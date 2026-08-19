import { useCallback } from 'react';

import { useAppStore } from '@/store';

export function generateCommandId(): string {
  // Prefer RFC4122/modern browsers, fallback for older environments.
  const maybeCrypto = globalThis.crypto as Crypto | undefined;
  if (maybeCrypto?.randomUUID) {
    return maybeCrypto.randomUUID();
  }
  return `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type CommandCategory = 'app' | 'hal' | 'machine' | 'motion' | 'program' | 'tool';

export interface CommandEnvelope<Params extends object = Record<string, unknown>> {
  type: 'command';
  protocolVersion: 1;
  commandId: string;
  category: CommandCategory;
  action: string;
  params: Params;
}

export function createCommandEnvelope<Params extends object = Record<string, unknown>>(
  category: CommandCategory,
  action: string,
  params?: Params,
  commandId?: string,
): CommandEnvelope<Params> {
  return {
    type: 'command',
    protocolVersion: 1,
    commandId: commandId ?? generateCommandId(),
    category,
    action,
    params: (params ?? ({} as Params)),
  };
}

type SendCommandFn = <Params extends object = Record<string, unknown>>(
  category: CommandCategory,
  action: string,
  params?: Params,
  commandId?: string,
) => boolean;

/**
 * Returns a function to send commands over the current WebSocket connection.
 *
 * This implementation assumes the WebSocket is held in app state.
 * The actual access (e.g. getState().backendWebSocket) can be adjusted as needed
 * once the connection lives in the store.
 *
 * @returns `true` when the envelope was written to an open socket; `false` otherwise.
 */
export function useSendCommand(): SendCommandFn {
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  const sendCommand = useCallback<SendCommandFn>(
    (category, action, params, commandId) => {
      // Always use the current socket from the store (avoids silently not sending when
      // listeners/closures hold a stale `sendCommand` instance).
      const ws = useAppStore.getState().backendWebSocket;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }

      const envelope = createCommandEnvelope(
        category,
        action,
        params,
        commandId ?? generateCommandId(),
      );

      const { debugLoggingEnabled, debugLogWsOutgoing } = useAppStore.getState();
      if (debugLoggingEnabled && debugLogWsOutgoing) {
        const timestamp = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.log('[debug][ws][out]', timestamp, envelope);
      }

      ws.send(JSON.stringify(envelope));
      return true;
    },
    [],
  );

  void connectionStatus;

  return sendCommand;
}

