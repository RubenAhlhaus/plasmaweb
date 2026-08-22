import { useTranslation } from 'react-i18next';

import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { usePlasmacNumber } from '@/hooks/usePlasmaPins';
import { cn } from '@/lib/utils';

/** QtPlasmaC's THC height override steps in whole volts and resets to zero. */
const STEP_VOLTS = 1;

export interface HeightOverrideControlProps {
  className?: string;
}

/**
 * THC height override: ±1 V and reset, exactly QtPlasmaC's MAIN-tab control.
 *
 * The displayed value is the pin, so the arithmetic happens once (here) and the machine
 * remains the source of truth for what the override currently is.
 */
export function HeightOverrideControl({ className }: HeightOverrideControlProps) {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const current = usePlasmacNumber('height-override') ?? 0;

  const buttonClass =
    'flex h-11 w-11 items-center justify-center rounded-lg border border-border/40 bg-card text-lg font-semibold text-foreground transition-colors hover:border-border/70';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border/25 bg-card px-3 py-2',
        className,
      )}
      data-e2e="plasma-height-override"
    >
      <div className="flex flex-col">
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
          {t('heightOverride.label')}
        </span>
        <span className="font-mono text-xl tabular-nums text-foreground" data-e2e="plasma-height-override-value">
          {current.toFixed(1)} <span className="text-xs text-muted-foreground">{t('units.volts')}</span>
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          aria-label={t('heightOverride.decrease')}
          data-e2e="plasma-height-override-minus"
          onClick={() => commands.heightOverride(current - STEP_VOLTS)}
        >
          −
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={t('heightOverride.increase')}
          data-e2e="plasma-height-override-plus"
          onClick={() => commands.heightOverride(current + STEP_VOLTS)}
        >
          +
        </button>
        <button
          type="button"
          className={cn(buttonClass, 'w-auto px-3 text-sm uppercase tracking-wide')}
          aria-label={t('heightOverride.reset')}
          data-e2e="plasma-height-override-reset"
          onClick={() => commands.heightOverride(0)}
        >
          {t('heightOverride.reset')}
        </button>
      </div>
    </div>
  );
}
