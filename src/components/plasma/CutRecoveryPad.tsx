import { useTranslation } from 'react-i18next';

import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { usePlasmacFlag, usePlasmacNumber } from '@/hooks/usePlasmaPins';

const padButtonClass =
  'flex h-11 items-center justify-center rounded-md border border-white/10 bg-slate-900/60 text-sm font-semibold text-foreground hover:border-white/25 disabled:opacity-30';

/** The eight directions, as (x, y) steps of one kerf width — QtPlasmaC's recovery pad. */
const DIRECTIONS: Array<{ key: string; x: number; y: number; label: string }> = [
  { key: 'nw', x: -1, y: 1, label: '↖' },
  { key: 'n', x: 0, y: 1, label: '↑' },
  { key: 'ne', x: 1, y: 1, label: '↗' },
  { key: 'w', x: -1, y: 0, label: '←' },
  { key: 'cancel', x: 0, y: 0, label: '' },
  { key: 'e', x: 1, y: 0, label: '→' },
  { key: 'sw', x: -1, y: -1, label: '↙' },
  { key: 's', x: 0, y: -1, label: '↓' },
  { key: 'se', x: 1, y: -1, label: '↘' },
];

/**
 * Cut recovery: move the torch while the program is paused, then carry on cutting.
 *
 * Two gestures, both upstream's. The pad moves the torch sideways off the path in whole kerf
 * widths — for restarting a cut that lost the arc, without recutting what is already cut. FWD
 * and REV run along the path itself at a share of the cut feed rate; releasing them stops the
 * motion but leaves the recovery armed, so the operator can nudge repeatedly.
 *
 * Only enabled while the interpreter is paused, because that is the only time plasmac accepts
 * it — and the realtime side, not this pad, owns how far the torch may travel.
 */
export function CutRecoveryPad({ paused }: { paused: boolean }) {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const recovering = usePlasmacFlag('cut-recovering');
  const xOffset = usePlasmacNumber('x-offset-current');
  const yOffset = usePlasmacNumber('y-offset-current');

  const disabled = !paused;

  return (
    <div className="flex flex-col gap-2" data-e2e="plasma-cut-recovery">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('cutRecovery.title')}
        </span>
        {recovering && (
          <span className="text-xs uppercase text-amber-300" data-e2e="plasma-cut-recovery-active">
            {t('cutRecovery.active')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {DIRECTIONS.map(({ key, x, y, label }) =>
          key === 'cancel' ? (
            <button
              key={key}
              type="button"
              className={padButtonClass}
              data-e2e="plasma-cut-recovery-cancel"
              disabled={disabled}
              onClick={() => commands.cutRecovery({ action: 'cancel' })}
              title={t('cutRecovery.cancel')}
            >
              ⊘
            </button>
          ) : (
            <button
              key={key}
              type="button"
              className={padButtonClass}
              data-e2e={`plasma-cut-recovery-${key}`}
              disabled={disabled}
              onClick={() => commands.cutRecovery({ action: 'offset', x, y })}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          className={`${padButtonClass} flex-1`}
          data-e2e="plasma-cut-recovery-rev"
          disabled={disabled}
          onPointerDown={() => commands.cutRecovery({ action: 'move', direction: -1 })}
          onPointerUp={() => commands.cutRecovery({ action: 'move', direction: 0 })}
          onPointerLeave={() => commands.cutRecovery({ action: 'move', direction: 0 })}
        >
          {t('cutRecovery.reverse')}
        </button>
        <button
          type="button"
          className={`${padButtonClass} flex-1`}
          data-e2e="plasma-cut-recovery-fwd"
          disabled={disabled}
          onPointerDown={() => commands.cutRecovery({ action: 'move', direction: 1 })}
          onPointerUp={() => commands.cutRecovery({ action: 'move', direction: 0 })}
          onPointerLeave={() => commands.cutRecovery({ action: 'move', direction: 0 })}
        >
          {t('cutRecovery.forward')}
        </button>
      </div>

      <div className="text-xs text-muted-foreground" data-e2e="plasma-cut-recovery-offset">
        {t('cutRecovery.offset', {
          x: xOffset?.toFixed(2) ?? '–',
          y: yOffset?.toFixed(2) ?? '–',
        })}
      </div>
    </div>
  );
}
