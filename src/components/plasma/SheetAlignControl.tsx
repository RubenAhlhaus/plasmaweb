import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { usePlasmaCommands, type PlasmaPeripheral } from '@/hooks/usePlasmaCommands';
import { useAppStore } from '@/store';
import type { PlasmaAlignment } from '@/store/types';

const buttonClass =
  'rounded-md border border-border/40 bg-card px-3 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40';

/**
 * QtPlasmaC's LASER / MARK EDGE / SET ORIGIN button: squaring the job to a crooked plate.
 *
 * One button, three presses. The label is the instruction — what to do next, not what was
 * just done — because between presses the operator is at the table driving the torch along
 * the plate edge, not reading the screen.
 *
 * The state comes from the backend, never from a click: the routine belongs to the machine,
 * and a shop with the panel and a laptop open must see the same step in both.
 */
export function SheetAlignControl({ kind = 'laser' }: { kind?: PlasmaPeripheral }) {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const available = useAppStore((s) => s.plasmaAvailable);
  const alignment = useAppStore((s) => s.plasmaAlignment);
  const setAlignment = useAppStore((s) => s.setPlasmaAlignment);

  const [message, setMessage] = useState<string | null>(null);
  const statusRef = useRef<string | null>(null);
  const pressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!available || alignment) return;
    const commandId = commands.getAlignment();
    if (commandId) statusRef.current = commandId;
  }, [available, alignment, commands]);

  usePendingWsCommandResult(statusRef, {
    onResult: (result) => {
      statusRef.current = null;
      if (result.ok && result.result) setAlignment(result.result as PlasmaAlignment);
    },
  });

  usePendingWsCommandResult(pressRef, {
    onResult: (result) => {
      pressRef.current = null;
      // A refused press matters: the operator is standing at the plate waiting for the laser.
      setMessage(result.ok ? null : result.error?.message ?? t('align.failed'));
    },
  });

  // Zero on both axes is how QtPlasmaC records "not fitted", and it hides the button too:
  // a machine with no alignment laser has nothing to align by.
  if (!alignment?.fitted?.[kind]) return null;

  const active = alignment.state !== 'idle' && alignment.kind === kind;
  const step = active ? alignment.state : 'idle';

  return (
    <div className="flex flex-col gap-2" data-e2e={`plasma-align-${kind}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t(`align.title.${kind}`)}
      </span>
      <button
        type="button"
        className={buttonClass}
        data-e2e={`plasma-align-${kind}-press`}
        onClick={() => {
          setMessage(null);
          const commandId = commands.alignmentPress(kind);
          if (commandId) pressRef.current = commandId;
        }}
      >
        {t(`align.step.${step}`)}
      </button>
      {active && (
        <button
          type="button"
          className={buttonClass}
          data-e2e={`plasma-align-${kind}-cancel`}
          onClick={() => {
            setMessage(null);
            commands.alignmentCancel();
          }}
        >
          {t('align.cancel')}
        </button>
      )}
      <span className="text-xs text-muted-foreground" data-e2e={`plasma-align-${kind}-hint`}>
        {t(`align.hint.${step}`)}
      </span>
      {alignment.angle !== undefined && !active && (
        <span className="text-xs text-primary" data-e2e={`plasma-align-${kind}-angle`}>
          {t('align.angle', { angle: alignment.angle.toFixed(2) })}
        </span>
      )}
      {message && (
        <span className="text-xs text-[color:var(--plasma-led)]" data-e2e={`plasma-align-${kind}-error`}>
          {message}
        </span>
      )}
    </div>
  );
}
