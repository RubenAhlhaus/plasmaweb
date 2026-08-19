import type { ReactNode } from 'react';
import { TouchNumericPickerField } from '@/components/numeric';
import { MacroFieldHintWrap } from '@/components/macros/MacroFieldHintWrap';
import { MACRO_PARAM_FIELD_CLASS, strParam } from '@/components/macros/macroParamFieldUtils';
import type { MacroParams, TouchNumericStackProps } from '@/types/macros';

type MacroNumericParamFieldCore = {
  paramKey: string;
  label: string;
  params: MacroParams;
  setParams: (next: MacroParams | ((prev: MacroParams) => MacroParams)) => void;
  setCommitError: (msg: string | null) => void;
  dialogAside: ReactNode | null;
  touchNumericStackProps?: TouchNumericStackProps;
  value?: string;
  onChange?: (value: string) => void;
};

type MacroNumericParamFieldNoHint = MacroNumericParamFieldCore & {
  hintWrap?: false;
  hintKey?: undefined;
  fallbackWrapper?: false;
};

type MacroNumericParamFieldWithHintWrap = MacroNumericParamFieldCore & {
  hintWrap: true;
  hintKey?: string | null;
  setHoveredHintKey: (key: string | null) => void;
  createNumericDialogOpenHandler: (hintKey: string | null) => (open: boolean) => void;
};

type MacroNumericParamFieldWithHintKey = MacroNumericParamFieldCore & {
  hintKey: string;
  hintWrap?: false;
  fallbackWrapper?: boolean;
  setHoveredHintKey: (key: string | null) => void;
  createNumericDialogOpenHandler: (hintKey: string | null) => (open: boolean) => void;
};

type MacroNumericParamFieldFallbackOnly = MacroNumericParamFieldCore & {
  hintKey?: null;
  hintWrap?: false;
  fallbackWrapper: true;
};

export type MacroNumericParamFieldProps =
  | MacroNumericParamFieldNoHint
  | MacroNumericParamFieldWithHintWrap
  | MacroNumericParamFieldWithHintKey
  | MacroNumericParamFieldFallbackOnly;

export function MacroNumericParamField(props: MacroNumericParamFieldProps) {
  const {
    paramKey,
    label,
    params,
    setParams,
    setCommitError,
    dialogAside,
    touchNumericStackProps,
    value: valueOverride,
    onChange: onChangeOverride,
  } = props;

  const hintWrap = 'hintWrap' in props && props.hintWrap === true;
  const hintKey = 'hintKey' in props ? props.hintKey : undefined;
  const fallbackWrapper = 'fallbackWrapper' in props && props.fallbackWrapper === true;
  const setHoveredHintKey =
    'setHoveredHintKey' in props ? props.setHoveredHintKey : undefined;
  const createNumericDialogOpenHandler =
    'createNumericDialogOpenHandler' in props ? props.createNumericDialogOpenHandler : undefined;

  if (import.meta.env.DEV && hintWrap && !setHoveredHintKey) {
    console.warn(
      `[MacroNumericParamField] hintWrap requires setHoveredHintKey (paramKey="${paramKey}")`,
    );
  }

  const value = valueOverride ?? strParam(params, paramKey);
  const onChange =
    onChangeOverride ??
    ((next: string) => {
      setCommitError(null);
      setParams((prev) => ({ ...prev, [paramKey]: next }));
    });

  const usesHintHandlers = hintWrap || hintKey != null;
  const onDialogOpenChange = usesHintHandlers
    ? createNumericDialogOpenHandler?.(hintKey ?? null)
    : touchNumericStackProps?.onDialogOpenChange;

  const picker = (
    <TouchNumericPickerField
      {...(touchNumericStackProps ?? {})}
      dialogAside={dialogAside}
      label={label}
      dialogTitle={label}
      value={value}
      onChange={onChange}
      onDialogOpenChange={onDialogOpenChange}
      className={MACRO_PARAM_FIELD_CLASS}
    />
  );

  if (hintWrap && setHoveredHintKey) {
    return (
      <MacroFieldHintWrap hintKey={hintKey ?? null} onHoverHint={setHoveredHintKey}>
        {picker}
      </MacroFieldHintWrap>
    );
  }

  if (hintKey && setHoveredHintKey) {
    return (
      <MacroFieldHintWrap hintKey={hintKey} onHoverHint={setHoveredHintKey}>
        {picker}
      </MacroFieldHintWrap>
    );
  }

  if (fallbackWrapper) {
    return <div>{picker}</div>;
  }

  return picker;
}
