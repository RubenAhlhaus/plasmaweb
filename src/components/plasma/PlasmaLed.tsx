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

/**
 * QtPlasmaC lights every indicator in one colour — the machine's `LED` — and keeps red for the
 * conditions that stop a cut. The tones stay as a distinction the code already makes; what
 * changed is where the colour comes from.
 */
const toneStyles: Record<PlasmaLedTone, { background: string; boxShadow: string }> = {
  green: {
    background: 'var(--plasma-led)',
    boxShadow: '0 0 12px 2px color-mix(in srgb, var(--plasma-led) 65%, transparent)',
  },
  blue: {
    background: 'var(--plasma-led)',
    boxShadow: '0 0 12px 2px color-mix(in srgb, var(--plasma-led) 65%, transparent)',
  },
  amber: {
    background: 'var(--plasma-led)',
    boxShadow: '0 0 12px 2px color-mix(in srgb, var(--plasma-led) 65%, transparent)',
  },
  red: {
    background: 'var(--plasma-estop)',
    boxShadow: '0 0 12px 2px color-mix(in srgb, var(--plasma-estop) 65%, transparent)',
  },
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
          'h-3 w-3 flex-shrink-0 rounded-full border border-border/40 transition-colors',
          unavailable && 'bg-muted/60',
          !unavailable && !on && 'bg-muted',
        )}
        style={!unavailable && on ? toneStyles[tone] : undefined}
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
