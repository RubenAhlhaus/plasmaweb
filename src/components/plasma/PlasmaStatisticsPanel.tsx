import { useTranslation } from 'react-i18next';

import { usePlasmacNumber } from '@/hooks/usePlasmaPins';
import { cn } from '@/lib/utils';

/** Seconds → `h:mm:ss`, the format QtPlasmaC's STATISTICS tab uses. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return '—';
  }
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface StatRowProps {
  label: string;
  value: string;
  e2e: string;
}

function StatRow({ label, value, e2e }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1" data-e2e={e2e}>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export interface PlasmaStatisticsPanelProps {
  className?: string;
}

/**
 * The current job's counters, straight from plasmac's statistics outputs.
 *
 * All of these pins are realtime-owned, so this panel is display-only; resetting them is
 * M2 work (it goes through the prefs file, not through the pins).
 */
export function PlasmaStatisticsPanel({ className }: PlasmaStatisticsPanelProps) {
  const { t } = useTranslation('plasma');

  const cutTime = usePlasmacNumber('cut-time');
  const torchTime = usePlasmacNumber('torch-time');
  const runTime = usePlasmacNumber('run-time');
  const rapidTime = usePlasmacNumber('rapid-time');
  const probeTime = usePlasmacNumber('probe-time');
  const pausedTime = usePlasmacNumber('paused-time');
  const pierceCount = usePlasmacNumber('pierce-count');
  const cutLength = usePlasmacNumber('cut-length');

  return (
    <section
      className={cn('rounded-lg border border-white/5 bg-slate-900/50 px-3 py-2', className)}
      data-e2e="plasma-statistics"
    >
      <h2 className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('statistics.title')}
      </h2>
      <StatRow label={t('statistics.cutTime')} value={formatDuration(cutTime)} e2e="plasma-stat-cut-time" />
      <StatRow label={t('statistics.torchTime')} value={formatDuration(torchTime)} e2e="plasma-stat-torch-time" />
      <StatRow label={t('statistics.runTime')} value={formatDuration(runTime)} e2e="plasma-stat-run-time" />
      <StatRow label={t('statistics.rapidTime')} value={formatDuration(rapidTime)} e2e="plasma-stat-rapid-time" />
      <StatRow label={t('statistics.probeTime')} value={formatDuration(probeTime)} e2e="plasma-stat-probe-time" />
      <StatRow label={t('statistics.pausedTime')} value={formatDuration(pausedTime)} e2e="plasma-stat-paused-time" />
      <StatRow
        label={t('statistics.pierceCount')}
        value={pierceCount === undefined ? '—' : String(Math.round(pierceCount))}
        e2e="plasma-stat-pierce-count"
      />
      <StatRow
        label={t('statistics.cutLength')}
        value={cutLength === undefined ? '—' : cutLength.toFixed(1)}
        e2e="plasma-stat-cut-length"
      />
    </section>
  );
}
