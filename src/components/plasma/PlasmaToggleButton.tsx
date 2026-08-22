import { cn } from '@/lib/utils';

export interface PlasmaToggleButtonProps {
  label: string;
  /** Current value, read back from HAL — never local state. */
  active: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  /** Hover text, in QtPlasmaC's own wording. Omitted when the machine has tips switched off. */
  title?: string;
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
  title,
  className,
  ...rest
}: PlasmaToggleButtonProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onToggle(!active)}
      data-e2e={rest['data-e2e']}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'flex min-h-[3rem] items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold uppercase tracking-wide transition-colors',
        // QtPlasmaC's own scheme: an active button is background-on-highlight and an idle one
        // is foreground-on-background, so the machine's colours decide, not a palette here.
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-card',
        disabled && 'cursor-not-allowed text-muted-foreground opacity-60 hover:bg-background',
        className,
      )}
    >
      {label}
    </button>
  );
}
