import { useEffect, useRef, type RefObject } from 'react';

import { findLatestCommandResultForId } from '@/lib/wsCommandResults';
import { useAppStore } from '@/store';
import type { LastWsCommandResult } from '@/store/types';

export type PendingWsCommandResultHandlerOptions = {
  enabled?: boolean;
  /** Called once per `commandId` when a matching result first appears in history. */
  onResult: (result: LastWsCommandResult) => void;
};

function deliverOnce(
  delivered: Set<string>,
  history: LastWsCommandResult[],
  commandId: string,
  onResult: (result: LastWsCommandResult) => void,
): void {
  if (delivered.has(commandId)) return;
  const result = findLatestCommandResultForId(history, commandId);
  if (!result) return;
  delivered.add(commandId);
  onResult(result);
}

function useDeliveredCommandIds(enabled: boolean): RefObject<Set<string>> {
  const deliveredRef = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) deliveredRef.current.clear();
  }, [enabled]);
  return deliveredRef;
}

/**
 * Waits for a WebSocket `command_result` matching `pendingCommandIdRef.current`.
 * Clear the ref when starting a new command or when the dialog closes.
 */
export function usePendingWsCommandResult(
  pendingCommandIdRef: RefObject<string | null>,
  { enabled = true, onResult }: PendingWsCommandResultHandlerOptions,
): void {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const deliveredRef = useDeliveredCommandIds(enabled);
  const commandResultHistory = useAppStore((s) => s.commandResultHistory);

  useEffect(() => {
    if (!enabled) return;
    const commandId = pendingCommandIdRef.current;
    if (!commandId) return;
    deliverOnce(deliveredRef.current, commandResultHistory, commandId, (result) => {
      onResultRef.current(result);
    });
  }, [commandResultHistory, deliveredRef, enabled, pendingCommandIdRef]);
}

export type PendingWsCommandResultsHandlerOptions = {
  enabled?: boolean;
  onResult: (commandId: string, result: LastWsCommandResult) => void;
};

/** Resolves each pending id in `pendingCommandIdsRef` independently. */
export function usePendingWsCommandResults(
  pendingCommandIdsRef: RefObject<Set<string>>,
  { enabled = true, onResult }: PendingWsCommandResultsHandlerOptions,
): void {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const deliveredRef = useDeliveredCommandIds(enabled);
  const commandResultHistory = useAppStore((s) => s.commandResultHistory);

  useEffect(() => {
    if (!enabled) return;
    const pending = pendingCommandIdsRef.current;
    if (pending.size === 0) return;
    for (const commandId of [...pending]) {
      deliverOnce(deliveredRef.current, commandResultHistory, commandId, (result) => {
        onResultRef.current(commandId, result);
      });
    }
  }, [commandResultHistory, deliveredRef, enabled, pendingCommandIdsRef]);
}

export type PendingWsCommandResultMapHandlerOptions<V> = {
  enabled?: boolean;
  onResult: (commandId: string, meta: V, result: LastWsCommandResult) => void;
};

/** Like {@link usePendingWsCommandResults} but preserves per-id metadata from a Map. */
export function usePendingWsCommandResultMap<V>(
  pendingRef: RefObject<Map<string, V>>,
  { enabled = true, onResult }: PendingWsCommandResultMapHandlerOptions<V>,
): void {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const deliveredRef = useDeliveredCommandIds(enabled);
  const commandResultHistory = useAppStore((s) => s.commandResultHistory);

  useEffect(() => {
    if (!enabled) return;
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    for (const [commandId, meta] of [...pending.entries()]) {
      deliverOnce(deliveredRef.current, commandResultHistory, commandId, (result) => {
        onResultRef.current(commandId, meta, result);
      });
    }
  }, [commandResultHistory, deliveredRef, enabled, pendingRef]);
}

/**
 * Runs `effect` whenever `commandResultHistory` changes (multi-step pipelines, MDI-first dialogs).
 * Prefer {@link usePendingWsCommandResult} for single-id correlation.
 */
export function useWsCommandResultHistoryEffect(
  effect: (history: LastWsCommandResult[]) => void,
  enabled = true,
): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const commandResultHistory = useAppStore((s) => s.commandResultHistory);

  useEffect(() => {
    if (!enabled) return;
    effectRef.current(commandResultHistory);
  }, [commandResultHistory, enabled]);
}
