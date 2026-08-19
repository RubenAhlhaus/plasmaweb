import { useTranslation } from 'react-i18next';
import { DEFAULT_JOG_INCREMENTS_SPEC } from '@/config/machineIniConfig';
import { parseJogIncrementsSpec } from '@/lib/jogIncrements';
import {
  jogIncrementButtonClassName,
  jogIncrementShellClassName,
} from '@/lib/jogControlSizeClasses';
import type { JogControlSize } from '@/lib/jogControlSize';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { Button } from './ui/button';

type IncrementSelectorProps = {
  size?: JogControlSize;
};

export function IncrementSelector({ size = 'compact' }: IncrementSelectorProps) {
  const { t } = useTranslation('components');
  const selectedJogIncrement = useAppStore((state) => state.selectedJogIncrement);
  const setSelectedJogIncrement = useAppStore((state) => state.setSelectedJogIncrement);
  const jogMode = useAppStore((state) => state.jogMode);
  const setJogMode = useAppStore((state) => state.setJogMode);
  const jogIncrementsSpec = useAppStore((state) => state.iniRuntimeConfig.jog_increments_spec);

  const parsed = parseJogIncrementsSpec(jogIncrementsSpec || DEFAULT_JOG_INCREMENTS_SPEC);
  const continuousLabel = t('jogIncrements.continuous');
  // +1 for the Continuous button
  const count = (parsed.length || 1) + 1;

  return (
    <div
      className={jogIncrementShellClassName(size)}
      role="tablist"
      aria-label={t('jogIncrements.ariaLabel')}
    >
      <Button
        variant={jogMode === 'continuous' ? 'default' : 'ghost'}
        onClick={() => setJogMode('continuous')}
        className={cn(
          'min-w-0 rounded-none rounded-t-lg border-0 border-b border-border/30 transition-colors',
          jogIncrementButtonClassName(size),
        )}
        style={{ height: `${100 / count}%` }}
        aria-pressed={jogMode === 'continuous'}
        role="tab"
      >
        {continuousLabel}
      </Button>
      {parsed.map((inc, idx) => (
        <Button
          key={idx}
          variant={
            jogMode === 'incremental' && inc.valueMu === selectedJogIncrement ? 'default' : 'ghost'
          }
          onClick={() => {
            setJogMode('incremental');
            setSelectedJogIncrement(inc.valueMu);
          }}
          className={cn(
            'min-w-0 rounded-none border-0 border-b border-border/30 transition-colors last:border-b-0',
            jogIncrementButtonClassName(size),
            idx === parsed.length - 1 && 'rounded-b-lg',
          )}
          style={{ height: `${100 / count}%` }}
          aria-pressed={jogMode === 'incremental' && inc.valueMu === selectedJogIncrement}
          role="tab"
        >
          {inc.label}
        </Button>
      ))}
    </div>
  );
}
