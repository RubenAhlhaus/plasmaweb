import { cn } from '@/lib/utils';

export type PlasmaLedTone = 'green' | 'amber' | 'red' | 'blue';

export interface PlasmaLedProps {
  label: string;
  /** `undefined` means this LinuxCNC build has no such pin — shown as unavailable, not off. */
  on: boolean | undefined;
  tone?: PlasmaLedTone;
  className?: string;
  'data-e2e'?: string;
}

const toneClasses: Record<PlasmaLedTone, string> = {
  green: 'bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.65)]',
  amber: 'bg-amber-400 shadow-[0_0_12px_2px_rgba(251,191,36,0.65)]',
  red: 'bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.65)]',
  blue: 'bg-sky-400 shadow-[0_0_12px_2px_rgba(56,189,248,0.65)]',
};

/**
 * One indicator for a `plasmac.*` bit output.
 *
 * These are read-only by construction: every pin behind an LED is realtime-owned, so the
 * component takes a value and never a setter.
 */
export function PlasmaLed({ label, on, tone = 'green', className, ...rest }: PlasmaLedProps) {
  const unavailable = on === undefined;

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      data-e2e={rest['data-e2e']}
      data-state={unavailable ? 'unavailable' : on ? 'on' : 'off'}
    >
      <span
        aria-hidden
        className={cn(
          'h-3 w-3 flex-shrink-0 rounded-full border border-white/10 transition-colors',
          unavailable && 'bg-slate-700/60',
          !unavailable && !on && 'bg-slate-600',
          !unavailable && on && toneClasses[tone],
        )}
      />
      <span
        className={cn(
          'truncate text-xs font-medium uppercase tracking-wide',
          unavailable ? 'text-muted-foreground/50' : on ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </div>
  );
}
