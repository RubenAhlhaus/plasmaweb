import { useCallback } from 'react';

import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { useAppStore } from '@/store';

export type SendMdiHistoryMode = 'immediate' | 'none';

export type SendMdiOptions = {
  commandId?: string;
  /** When to append to `mdiCommandHistory`. Default: `immediate`. */
  history?: SendMdiHistoryMode;
};

/** Sends `program.mdi` and optionally appends to the home MDI history ring. */
export function useSendMdiCommand() {
  const sendCommand = useSendCommand();
  const appendMdiCommandHistory = useAppStore((s) => s.appendMdiCommandHistory);

  const sendMdi = useCallback(
    (text: string, options?: SendMdiOptions): string | null => {
      const trimmed = text.trim();
      if (!trimmed) return null;

      const commandId = options?.commandId ?? generateCommandId();
      sendCommand('program', 'mdi', { text: trimmed }, commandId);

      if (options?.history !== 'none') {
        appendMdiCommandHistory(trimmed);
      }

      return commandId;
    },
    [appendMdiCommandHistory, sendCommand],
  );

  return { sendMdi, appendMdiCommandHistory };
}
