import { ToggleSwitch } from '@/components/ui/ToggleSwitch';

type MacroToggleSwitchProps = {
  checked: boolean;
  label: string;
  ariaLabelOn: string;
  ariaLabelOff: string;
  onCheckedChange: () => void;
  className?: string;
  'data-e2e'?: string;
  disabled?: boolean;
  title?: string;
};

/** Shared toggle switch UI for macro parameter dialogs. */
export function MacroToggleSwitch({
  checked,
  label,
  ariaLabelOn,
  ariaLabelOff,
  onCheckedChange,
  className,
  'data-e2e': dataE2e,
  disabled,
  title,
}: MacroToggleSwitchProps) {
  return (
    <ToggleSwitch
      checked={checked}
      label={label}
      ariaLabelOn={ariaLabelOn}
      ariaLabelOff={ariaLabelOff}
      onCheckedChange={onCheckedChange}
      className={className}
      size="md"
      data-e2e={dataE2e}
      disabled={disabled}
      title={title}
    />
  );
}
