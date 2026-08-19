import type { LastWsCommandResult } from '@/store/types';

const COMMAND_RESULT_HISTORY_CAP = 64;

export function appendCommandResultToHistory(
  prev: LastWsCommandResult[],
  result: LastWsCommandResult,
): LastWsCommandResult[] {
  return [...prev, result].slice(-COMMAND_RESULT_HISTORY_CAP);
}

/** Newest result for `commandId` (search from end — last match wins if duplicates). */
export function findLatestCommandResultForId(
  history: LastWsCommandResult[],
  commandId: string,
): LastWsCommandResult | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e?.commandId === commandId) return e;
  }
  return undefined;
}
