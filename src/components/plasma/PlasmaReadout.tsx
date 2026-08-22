import { cn } from '@/lib/utils';

export interface PlasmaReadoutProps {
  label: string;
  /** `undefined` renders a dash: a pin this build lacks must not read as a real zero. */
  value: number | undefined;
  unit?: string;
  decimals?: number;
  emphasis?: boolean;
  className?: string;
  'data-e2e'?: string;
}

/** A labelled numeric value from a plasmac output pin (arc volts, Z height, feed rate, …). */
export function PlasmaReadout({
  label,
  value,
  unit,
  decimals = 1,
  emphasis = false,
  className,
  ...rest
}: PlasmaReadoutProps) {
  const text = value === undefined ? '—' : value.toFixed(decimals);

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border/25 bg-card px-3 py-2',
        className,
      )}
      data-e2e={rest['data-e2e']}
    >
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          className={cn(
            'font-mono tabular-nums',
            emphasis ? 'text-3xl font-semibold text-foreground' : 'text-xl text-foreground/90',
            value === undefined && 'text-muted-foreground/60',
          )}
        >
          {text}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}
