import { useTranslation } from 'react-i18next';

import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { usePlasmaTooltips } from '@/hooks/usePlasmaTooltips';
import { usePlasmacFlag, usePlasmacNumber } from '@/hooks/usePlasmaPins';
import { useAppStore } from '@/store';

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
 * A third gesture on machines with an alignment laser: LASER offsets the axes by the laser
 * offset, so the laser lands where the torch stopped and the operator can see the spot they
 * are restarting from. plasmac reverses that offset on resume.
 *
 * Only enabled while the interpreter is paused, because that is the only time plasmac accepts
 * it — and the realtime side, not this pad, owns how far the torch may travel.
 */
export function CutRecoveryPad({ paused }: { paused: boolean }) {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const tip = usePlasmaTooltips();
  const recovering = usePlasmacFlag('cut-recovering');
  const laserState = usePlasmacNumber('laser-recovery-state');
  // Zero on both axes is how QtPlasmaC records "no laser fitted", so there is nothing to
  // offset by and the button has no meaning.
  const laserFitted = useAppStore((s) => s.plasmaAlignment?.fitted?.laser === true);
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
              title={tip('cutRecCancel') ?? t('cutRecovery.cancel')}
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
              // Upstream words each arrow by the axes it moves, not by a compass point.
              title={tip('cutRecMove')?.replace(
                '{{direction}}',
                `${x > 0 ? 'X+' : x < 0 ? 'X-' : ''} ${y > 0 ? 'Y+' : y < 0 ? 'Y-' : ''}`.trim(),
              )}
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
          title={tip('cutRecRev')}
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
          title={tip('cutRecFwd')}
          disabled={disabled}
          onPointerDown={() => commands.cutRecovery({ action: 'move', direction: 1 })}
          onPointerUp={() => commands.cutRecovery({ action: 'move', direction: 0 })}
          onPointerLeave={() => commands.cutRecovery({ action: 'move', direction: 0 })}
        >
          {t('cutRecovery.forward')}
        </button>
      </div>

      {laserFitted && (
        <button
          type="button"
          className={padButtonClass}
          data-e2e="plasma-cut-recovery-laser"
          data-active={Boolean(laserState)}
          disabled={disabled}
          onClick={() => commands.cutRecovery({ action: 'laser' })}
          title={tip('laser') ?? t('cutRecovery.laserHint')}
        >
          {t('cutRecovery.laser')}
        </button>
      )}

      <div className="text-xs text-muted-foreground" data-e2e="plasma-cut-recovery-offset">
        {t('cutRecovery.offset', {
          x: xOffset?.toFixed(2) ?? '–',
          y: yOffset?.toFixed(2) ?? '–',
        })}
      </div>
    </div>
  );
}
