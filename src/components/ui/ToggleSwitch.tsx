import { useId } from 'react';

import { cn } from '@/lib/utils';

type ToggleSwitchSize = 'sm' | 'md';

type ToggleSwitchProps = {
  checked: boolean;
  onCheckedChange: () => void;
  size?: ToggleSwitchSize;
  label?: string;
  ariaLabelOn?: string;
  ariaLabelOff?: string;
  className?: string;
  id?: string;
  'data-e2e'?: string;
  disabled?: boolean;
  title?: string;
};

const sizeClasses: Record<ToggleSwitchSize, { track: string; knob: string }> = {
  sm: {
    track: 'h-6 w-11 px-1',
    knob: 'h-4 w-4',
  },
  md: {
    track: 'h-8 w-14 px-1',
    knob: 'h-5 w-5',
  },
};

/** Shared toggle switch for settings rows and macro parameter dialogs. */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  size = 'md',
  label,
  ariaLabelOn,
  ariaLabelOff,
  className,
  id,
  'data-e2e': dataE2e,
  disabled = false,
  title,
}: ToggleSwitchProps) {
  const generatedId = useId();
  const labelId = useId();
  const switchId = id ?? generatedId;
  const sizes = sizeClasses[size];
  const stateLabel = checked ? ariaLabelOn : ariaLabelOff;

  const switchButton = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={stateLabel}
      aria-labelledby={label && !stateLabel ? labelId : undefined}
      data-e2e={dataE2e}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      onClick={disabled ? undefined : onCheckedChange}
      className={cn(
        sizes.track,
        'shrink-0 rounded-full border border-border/60 flex items-center transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-primary/50 touch-manipulation',
        checked ? 'bg-primary/80 justify-end' : 'bg-muted/50 justify-start',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={cn(sizes.knob, 'rounded-full bg-white shadow-sm block')} />
    </button>
  );

  if (!label) {
    return <div className={className}>{switchButton}</div>;
  }

  return (
    <div
      title={title}
      className={cn(
        'flex min-h-14 items-center justify-between gap-4 md:col-span-2',
        className,
      )}
    >
      <span id={labelId} className="text-sm text-muted-foreground">
        {label}
      </span>
      {switchButton}
    </div>
  );
}
