import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';

interface LogEntry {
  at: number;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

interface LogResult {
  entries: LogEntry[];
  lastCritical: LogEntry | null;
  count: number;
}

const SEVERITY_CLASS: Record<LogEntry['severity'], string> = {
  critical: 'text-destructive',
  warning: 'text-[color:var(--plasma-led)]',
  info: 'text-muted-foreground',
};

const buttonClass =
  'rounded-md border border-border/40 bg-card px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40';

function stamp(at: number): string {
  return new Date(at * 1000).toLocaleTimeString();
}

/**
 * What the machine said: the plasma equivalent of QtPlasmaC's machine log.
 *
 * The realtime component prints its faults through LinuxCNC's error channel — "float switch
 * activated, program is paused", "no arc detected after 3 start attempts" — and a toast that
 * has already faded is no use to whoever comes back to a paused machine and has to work out
 * why it stopped. So the newest message is pinned at the top when it is critical, and the
 * history is here to scroll.
 *
 * Severity comes from the backend, which matches the wording against upstream's own documented
 * critical/warning lists rather than guessing from the text here.
 */
export function MachineLogPanel() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();

  const [log, setLog] = useState<LogResult | null>(null);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const logRef = useRef<string | null>(null);
  const saveRef = useRef<string | null>(null);

  const refresh = useCallback(
    (onlyCritical: boolean) => {
      const commandId = commands.machineLog(
        onlyCritical ? { severity: 'critical', limit: 200 } : { limit: 200 },
      );
      if (commandId) logRef.current = commandId;
    },
    [commands],
  );

  useEffect(() => {
    refresh(criticalOnly);
    // The log is polled on demand rather than streamed: it is a history, not a live reading,
    // and the errors themselves already arrive as their own messages.
  }, [refresh, criticalOnly]);

  usePendingWsCommandResult(logRef, {
    onResult: (result) => {
      logRef.current = null;
      if (result.ok && result.result) setLog(result.result as LogResult);
    },
  });

  usePendingWsCommandResult(saveRef, {
    onResult: (result) => {
      saveRef.current = null;
      setSaved(
        result.ok
          ? ((result.result as { path?: string })?.path ?? null)
          : (result.error?.message ?? null),
      );
    },
  });

  const entries = log?.entries ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-e2e="plasma-machine-log">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('log.title')}
        </span>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-machine-log-refresh"
          onClick={() => refresh(criticalOnly)}
        >
          {t('log.refresh')}
        </button>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-machine-log-critical"
          data-active={criticalOnly}
          onClick={() => setCriticalOnly((prev) => !prev)}
        >
          {t('log.criticalOnly')}
        </button>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-machine-log-save"
          onClick={() => {
            const commandId = commands.saveMachineLog();
            if (commandId) saveRef.current = commandId;
          }}
        >
          {t('log.save')}
        </button>
      </div>

      {log?.lastCritical && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/15 px-3 py-2 text-sm text-destructive"
          data-e2e="plasma-machine-log-last-critical"
        >
          <span className="font-semibold">{t('log.lastCritical')}</span>{' '}
          {log.lastCritical.message}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-background">
        {entries.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground" data-e2e="plasma-machine-log-empty">
            {t('log.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border/25">
            {entries
              .slice()
              .reverse()
              .map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  className="flex gap-3 px-3 py-1.5 text-sm"
                  data-e2e="plasma-machine-log-entry"
                  data-severity={entry.severity}
                >
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {stamp(entry.at)}
                  </span>
                  <span className={SEVERITY_CLASS[entry.severity] ?? SEVERITY_CLASS.info}>
                    {entry.message}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>

      {saved && (
        <span className="text-xs text-muted-foreground" data-e2e="plasma-machine-log-saved">
          {saved}
        </span>
      )}
    </div>
  );
}
