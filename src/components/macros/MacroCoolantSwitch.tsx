import { useTranslation } from 'react-i18next';
import { MacroToggleSwitch } from '@/components/macros/MacroToggleSwitch';
import { boolParam } from '@/components/macros/macroParamFieldUtils';
import type { MacroParams } from '@/types/macros';

type MacroCoolantSwitchProps = {
  params: MacroParams;
  setParams: (next: MacroParams | ((prev: MacroParams) => MacroParams)) => void;
  setCommitError: (msg: string | null) => void;
};

export function MacroCoolantSwitch({ params, setParams, setCommitError }: MacroCoolantSwitchProps) {
  const { t } = useTranslation('macros');
  const on = boolParam(params, 'coolantOn');

  return (
    <MacroToggleSwitch
      checked={on}
      label={t('dialog.coolant')}
      ariaLabelOn={t('dialog.coolantOn')}
      ariaLabelOff={t('dialog.coolantOff')}
      onCheckedChange={() => {
        setCommitError(null);
        setParams((prev) => ({
          ...prev,
          coolantOn: !boolParam(prev, 'coolantOn'),
        }));
      }}
    />
  );
}
