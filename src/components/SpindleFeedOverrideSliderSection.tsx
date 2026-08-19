import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { TouchNumericPickerField } from '@/components/numeric';
import { Slider } from '@/components/ui/slider';

const touchSliderClass =
  '[&>input[type=range]]:h-4 [&>input[type=range]]:min-h-[3rem] [&>input[type=range]]:cursor-pointer';

const overridePercentTriggerClassName =
  'w-auto min-h-12 shrink-0 rounded-md border border-input/70 bg-background px-4 py-2 text-lg font-mono touch-manipulation hover:bg-muted/40 focus:ring-2 focus:ring-ring';

function snapToStep(n: number, min: number, max: number, step: number): number {
  const stepped = step > 0 ? Math.round(n / step) * step : Math.round(n);
  return Math.min(max, Math.max(min, Math.round(stepped)));
}

export type OverrideSliderSectionProps = {
  label: string;
  currentLabel: string;
  value: number;
  min: number;
  max: number;
  onValueChange: (value: number) => void;
  ariaLabel: string;
  sliderE2e?: string;
  valuePickerE2e?: string;
  onPickerDialogOpenChange?: (open: boolean) => void;
  showDivider?: boolean;
  /** Displayed next to the value picker (default `%`). */
  unit?: string;
  /** Integer step for the numeric picker (default 1). */
  step?: number;
  /** Integer step for the range slider; defaults to `step`. */
  sliderStep?: number;
};

export function OverrideSliderSection({
  label,
  currentLabel,
  value,
  min,
  max,
  onValueChange,
  ariaLabel,
  sliderE2e,
  valuePickerE2e,
  onPickerDialogOpenChange,
  showDivider = false,
  unit = '%',
  step = 1,
  sliderStep,
}: OverrideSliderSectionProps) {
  const { t } = useTranslation('components');
  const rangeStep = sliderStep ?? step;

  const validateParsed = useCallback(
    (n: number) => {
      if (!Number.isFinite(n) || n < min || n > max) {
        return t('spindleFeed.valueOutOfRange', { min, max });
      }
      return null;
    },
    [max, min, t],
  );

  const handlePickerChange = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      onValueChange(snapToStep(n, min, max, step));
    },
    [max, min, onValueChange, step],
  );

  const handleSliderChange = useCallback(
    (next: number) => {
      onValueChange(snapToStep(next, min, max, rangeStep));
    },
    [max, min, onValueChange, rangeStep],
  );

  return (
    <div
      className={
        showDivider
          ? 'flex flex-col gap-4 pt-2 border-t border-border/50'
          : 'flex flex-col gap-4'
      }
    >
      <div className="space-y-3">
        <div className="text-base font-medium text-muted-foreground">{label}</div>
        <div className="flex justify-between items-center gap-3 text-lg">
          <span className="text-foreground shrink-0">{currentLabel}</span>
          <TouchNumericPickerField
            hideLabel
            label={label}
            dialogTitle={label}
            value={String(Math.round(value))}
            onChange={handlePickerChange}
            integerOnly
            unit={unit}
            validateParsed={validateParsed}
            triggerClassName={overridePercentTriggerClassName}
            onDialogOpenChange={onPickerDialogOpenChange}
            data-e2e={valuePickerE2e}
          />
        </div>
        <Slider
          min={min}
          max={max}
          step={rangeStep}
          value={value}
          onValueChange={handleSliderChange}
          className={touchSliderClass}
          aria-label={ariaLabel}
          data-e2e={sliderE2e}
        />
      </div>
    </div>
  );
}
