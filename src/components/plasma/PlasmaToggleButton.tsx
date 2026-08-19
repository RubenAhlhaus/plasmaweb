import { cn } from '@/lib/utils';

export interface PlasmaToggleButtonProps {
  label: string;
  /** Current value, read back from HAL — never local state. */
  active: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  'data-e2e'?: string;
}

/**
 * A latching toggle whose displayed state comes from the pin, not from the click.
 *
 * The click sends a command; the button only changes appearance once HAL reports the new
 * value. If a write is refused (policy, missing pin, HAL writer), the button stays put,
 * which is the honest thing for a machine control to do.
 */
export function PlasmaToggleButton({
  label,
  active,
  onToggle,
  disabled = false,
  className,
  ...rest
}: PlasmaToggleButtonProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      disabled={disabled}
      onClick={() => onToggle(!active)}
      data-e2e={rest['data-e2e']}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'flex min-h-[3rem] items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold uppercase tracking-wide transition-colors',
        active
          ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
          : 'border-white/10 bg-slate-900/60 text-muted-foreground hover:border-white/20 hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-40 hover:border-white/10 hover:text-muted-foreground',
        className,
      )}
    >
      {label}
    </button>
  );
}
