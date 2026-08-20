import { useCallback, useEffect, useRef } from 'react';

import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { useAppStore } from '@/store';
import type { PlasmaToolpath } from '@/store/types';

/**
 * Keeps the store's preview in step with the loaded program.
 *
 * The preview is asked for once per program, not per render: parsing is the interpreter doing
 * real work on the machine's CPU, next to a running cut. A reload of the same path re-parses
 * only because LinuxCNC reports a different file or the caller asks.
 */
export function usePlasmaToolpath(): { refresh: () => void } {
  const commands = usePlasmaCommands();
  const available = useAppStore((s) => s.plasmaAvailable);
  const programFile = useAppStore((s) => s.linuxCncStatus.program.file);
  const setToolpath = useAppStore((s) => s.setPlasmaToolpath);
  const setError = useAppStore((s) => s.setPlasmaToolpathError);
  const setLoading = useAppStore((s) => s.setPlasmaToolpathLoading);

  const pendingRef = useRef<string | null>(null);
  const requestedForRef = useRef<string | null>(null);

  const request = useCallback(
    (path?: string) => {
      const commandId = commands.toolpath(path);
      if (!commandId) return;
      pendingRef.current = commandId;
      setLoading(true);
    },
    [commands, setLoading],
  );

  usePendingWsCommandResult(pendingRef, {
    onResult: (result) => {
      pendingRef.current = null;
      if (result.ok && result.result) {
        setToolpath(result.result as unknown as PlasmaToolpath);
        return;
      }
      // A G-code error is the interpreter's answer, not a transport failure: show it.
      const message =
        (result.error && (result.error.message || result.error.code)) || 'preview failed';
      setError(message);
    },
  });

  useEffect(() => {
    if (!available) return;
    const path = typeof programFile === 'string' ? programFile.trim() : '';
    if (!path) {
      requestedForRef.current = null;
      setToolpath(null);
      return;
    }
    if (requestedForRef.current === path) return;
    requestedForRef.current = path;
    request(path);
  }, [available, programFile, request, setToolpath]);

  const refresh = useCallback(() => {
    const path = typeof programFile === 'string' ? programFile.trim() : '';
    request(path || undefined);
  }, [programFile, request]);

  return { refresh };
}
