import { useTranslation } from 'react-i18next';
import { MacroToggleSwitch } from '@/components/macros/MacroToggleSwitch';
import { boolParam, strParam } from '@/components/macros/macroParamFieldUtils';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import type { MacroParams } from '@/types/macros';

type MacroFullRetractSwitchProps = {
  params: MacroParams;
  setParams: (next: MacroParams | ((prev: MacroParams) => MacroParams)) => void;
  setCommitError: (msg: string | null) => void;
};

/** True when plunge depth is set and strictly below total drill depth (same rule as emitProgram pecking). */
export function isDrillPeckingEnabled(params: MacroParams): boolean {
  const depth = parseTouchNumericForCommit(strParam(params, 'depth').trim());
  const peck = parseTouchNumericForCommit(strParam(params, 'einstechtiefeMm').trim());
  return depth !== null && peck !== null && peck > 0 && peck < depth;
}

export function MacroFullRetractSwitch({
  params,
  setParams,
  setCommitError,
}: MacroFullRetractSwitchProps) {
  const { t } = useTranslation('macros');
  const on = boolParam(params, 'fullRetract');
  const pecking = isDrillPeckingEnabled(params);
  const requiresPeckHint = t('dialog.fullRetractRequiresPeck');

  return (
    <MacroToggleSwitch
      checked={on}
      label={t('dialog.fullRetract')}
      ariaLabelOn={t('dialog.fullRetractOn')}
      ariaLabelOff={t('dialog.fullRetractOff')}
      disabled={!pecking}
      title={!pecking ? requiresPeckHint : undefined}
      onCheckedChange={() => {
        if (!isDrillPeckingEnabled(params)) return;
        setCommitError(null);
        setParams((prev) => ({
          ...prev,
          fullRetract: !boolParam(prev, 'fullRetract'),
        }));
      }}
    />
  );
}
