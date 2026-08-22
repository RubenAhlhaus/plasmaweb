import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TouchNumericPickerField } from '@/components/numeric';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';

/**
 * QtPlasmaC's SINGLE CUT: one straight cut from wherever the torch is standing.
 *
 * The cut is *loaded*, not started — pressing cycle start is a separate, deliberate act, and
 * this panel sits next to a torch that is about to fire. Upstream's dialog behaves the same
 * way: CUT builds the program and the operator still has to run it.
 */
export function SingleCutControl() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [loaded, setLoaded] = useState(false);

  const lengths = [Number(x), Number(y)];
  const valid = lengths.every(Number.isFinite) && lengths.some((value) => value !== 0);

  return (
    <div className="flex flex-col gap-2" data-e2e="plasma-single-cut">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('singleCut.title')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <TouchNumericPickerField
          label={t('singleCut.x')}
          value={x}
          unit="mm"
          onChange={(value) => {
            setX(value);
            setLoaded(false);
          }}
          data-e2e="plasma-single-cut-x"
        />
        <TouchNumericPickerField
          label={t('singleCut.y')}
          value={y}
          unit="mm"
          onChange={(value) => {
            setY(value);
            setLoaded(false);
          }}
          data-e2e="plasma-single-cut-y"
        />
      </div>
      <button
        type="button"
        className="rounded-md border border-border/40 bg-card px-3 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40"
        data-e2e="plasma-single-cut-load"
        disabled={!valid}
        onClick={() => {
          commands.singleCut(lengths[0], lengths[1]);
          setLoaded(true);
        }}
      >
        {t('singleCut.cut')}
      </button>
      <span className="text-xs text-muted-foreground" data-e2e="plasma-single-cut-hint">
        {loaded ? t('singleCut.loaded') : t('singleCut.hint')}
      </span>
    </div>
  );
}
