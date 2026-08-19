import { useTranslation } from 'react-i18next';

interface SliderControlProps {
  /** Prefix shown with the value below (e.g. "F" → "F5700") */
  valuePrefix?: string;
  value: number;
  /** Percent value for override display (e.g. 98 for "98%") */
  percentage?: number;
  /** Small caption under the value (e.g. "Spindle", "Feed Rate") */
  label?: string;
  /** Unit next to the number (e.g. "1/min", "mm/min") — small and muted */
  unit?: string;
  /** When set, the large number is rounded to an integer (spindle RPM, effective feed with odd overrides). */
  integerDisplay?: boolean;
  /** Entire circle/value area is clickable (e.g. open dialog). */
  onClick?: () => void;
  /** `aria-label` for the clickable area; fallback: label or "display". */
  interactiveAriaLabel?: string;
}

export function SliderControl({
  valuePrefix,
  value,
  percentage,
  label,
  unit,
  onClick,
  interactiveAriaLabel,
  integerDisplay,
}: SliderControlProps) {
  const { t } = useTranslation('components');
  const shown =
    integerDisplay === true ? Math.round(Number.isFinite(value) ? value : 0) : value;
  const displayValue = valuePrefix ? `${valuePrefix}${shown}` : String(shown);
  const clampedPercentage = Math.max(0, Math.min(percentage ?? 0, 200));
  const progress = clampedPercentage / 200;
  const radius = 60;
  const strokeWidth = 8;
  const cx = 70;
  const cy = 70;
  const segmentCount = 64;
  const markerPercent = 100 / 200;
  const markerAngle = Math.PI + markerPercent * 2 * Math.PI;
  const markerInnerRadius = radius - strokeWidth * 0.2;
  const markerOuterRadius = radius + strokeWidth * 0.2;
  const markerX1 = cx + markerInnerRadius * Math.cos(markerAngle);
  const markerY1 = cy + markerInnerRadius * Math.sin(markerAngle);
  const markerX2 = cx + markerOuterRadius * Math.cos(markerAngle);
  const markerY2 = cy + markerOuterRadius * Math.sin(markerAngle);
  // Start at 9 o'clock (left), clockwise 9→12→3→6; gradient scales with progress
  const segments =
    progress > 0
      ? Array.from({ length: segmentCount }, (_, i) => {
          const t0 = i / segmentCount;
          const t1 = (i + 1) / segmentCount;
          const startAngle = Math.PI + t0 * progress * 2 * Math.PI;
          const endAngle = Math.PI + t1 * progress * 2 * Math.PI;
          const t = i / Math.max(1, segmentCount - 1);
          const hue = 120 - 120 * t * progress;
          return {
            path: `M ${cx + radius * Math.cos(startAngle)} ${cy + radius * Math.sin(startAngle)} A ${radius} ${radius} 0 0 1 ${cx + radius * Math.cos(endAngle)} ${cy + radius * Math.sin(endAngle)}`,
            color: `hsl(${hue}, 90%, 50%)`,
          };
        })
      : [];

  const ringContent = (
    <>
      <svg viewBox="0 0 140 140" className="absolute inset-0 pointer-events-none">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          strokeWidth={strokeWidth}
          className="text-slate-700"
          fill="none"
          stroke="currentColor"
        />
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        ))}
        <line
          x1={markerX1}
          y1={markerY1}
          x2={markerX2}
          y2={markerY2}
          stroke="rgba(15, 23, 42, 0.9)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="text-base font-mono text-foreground/70">
          {clampedPercentage.toFixed(0)}%
        </span>
        <div className="mt-1 flex items-baseline justify-center gap-1.5">
          <span className="text-4xl font-mono font-semibold text-foreground">{displayValue}</span>
          {unit && (
            <span className="text-xs font-mono text-foreground/70">{unit}</span>
          )}
        </div>
        {label && (
          <span className="mt-0.5 text-xs font-mono text-foreground/70">{label}</span>
        )}
      </div>
    </>
  );

  const aria =
    interactiveAriaLabel ??
    (label
      ? t('slider.openSettingsWithLabel', { label })
      : t('slider.openSettingsDisplay'));

  return (
    <div className="w-full py-4">
      <div className="flex flex-col items-center justify-center">
        {percentage != null &&
          (onClick ? (
            <button
              type="button"
              onClick={onClick}
              aria-label={aria}
              className="relative h-48 w-48 flex items-center justify-center rounded-full cursor-pointer border-0 bg-transparent p-0 text-inherit hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {ringContent}
            </button>
          ) : (
            <div className="relative h-48 w-48 flex items-center justify-center">{ringContent}</div>
          ))}
      </div>
    </div>
  );
}
