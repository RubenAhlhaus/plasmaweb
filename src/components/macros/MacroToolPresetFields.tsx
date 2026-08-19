import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TouchSelectField } from '@/components/ui/TouchSelectField';
import {
  MACRO_PARAM_FIELD_CLASS,
  macroToolSelectOptions,
  strParam,
} from '@/components/macros/macroParamFieldUtils';
import { presetMdiValues } from '@/lib/presetMdiValues';
import type { MacroParams } from '@/types/macros';
import type { Tool } from '@/types/tools';

export type MacroFeedParamKey = 'feed' | 'feedXY' | 'feedZ';

type UseMacroToolPresetOptions = {
  tools: Tool[];
  params: MacroParams;
  setParams: (next: MacroParams | ((prev: MacroParams) => MacroParams)) => void;
  setCommitError: (msg: string | null) => void;
  feedKeys: MacroFeedParamKey[];
};

function clearFeedKeys(params: MacroParams, feedKeys: MacroFeedParamKey[]): MacroParams {
  const next = { ...params };
  for (const key of feedKeys) {
    next[key] = '';
  }
  return next;
}

/** Shared tool/preset state and handlers for drill, face-milling, and helical-bore macro forms. */
export function useMacroToolPreset({
  tools,
  params,
  setParams,
  setCommitError,
  feedKeys,
}: UseMacroToolPresetOptions) {
  const toolOptions = useMemo(() => macroToolSelectOptions(tools), [tools]);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === strParam(params, 'toolId')),
    [tools, params],
  );

  const presetOptions = useMemo(
    () =>
      (selectedTool?.lcncguiPresets ?? []).map((preset) => ({
        value: preset.id,
        label: preset.name || preset.id,
      })),
    [selectedTool],
  );

  const presetId = strParam(params, 'presetId');

  const onToolChange = (toolId: string) => {
    setCommitError(null);
    setParams((prev) =>
      clearFeedKeys(
        {
          ...prev,
          toolId,
          presetId: '',
          spindle: '',
        },
        feedKeys,
      ),
    );
  };

  const onPresetChange = (nextPresetId: string) => {
    setCommitError(null);
    if (nextPresetId === '') {
      setParams((prev) =>
        clearFeedKeys(
          {
            ...prev,
            presetId: '',
            spindle: '',
          },
          feedKeys,
        ),
      );
      return;
    }
    const preset = selectedTool?.lcncguiPresets?.find((p) => p.id === nextPresetId);
    const mdi = presetMdiValues(preset);
    setParams((prev) => {
      const next = {
        ...prev,
        presetId: nextPresetId,
        spindle: mdi ? String(mdi.s) : '',
      };
      for (const key of feedKeys) {
        next[key] = mdi ? String(mdi.f) : '';
      }
      return next;
    });
  };

  return {
    toolOptions,
    selectedTool,
    presetOptions,
    presetId,
    onToolChange,
    onPresetChange,
  };
}

type MacroToolIdFieldProps = {
  tools: Tool[];
  params: MacroParams;
  toolOptions: Array<{ value: string; label: string }>;
  onToolChange: (toolId: string) => void;
};

export function MacroToolIdField({ tools, params, toolOptions, onToolChange }: MacroToolIdFieldProps) {
  const { t } = useTranslation('macros');

  return (
    <TouchSelectField
      className={MACRO_PARAM_FIELD_CLASS}
      label={t('paramLabels.toolId')}
      value={strParam(params, 'toolId')}
      onChange={onToolChange}
      options={toolOptions}
      dialogTitle={t('dialog.selectTool')}
      disabled={tools.length === 0}
    />
  );
}

type MacroPresetIdFieldProps = {
  presetId: string;
  presetOptions: Array<{ value: string; label: string }>;
  selectedTool: Tool | undefined;
  onPresetChange: (presetId: string) => void;
};

export function MacroPresetIdField({
  presetId,
  presetOptions,
  selectedTool,
  onPresetChange,
}: MacroPresetIdFieldProps) {
  const { t } = useTranslation('macros');

  return (
    <TouchSelectField
      className={MACRO_PARAM_FIELD_CLASS}
      label={t('paramLabels.presetId')}
      value={presetId}
      onChange={onPresetChange}
      options={presetOptions}
      allowEmpty
      emptyLabel={t('dialog.emptyPreset')}
      dialogTitle={t('dialog.selectPreset')}
      disabled={!selectedTool}
    />
  );
}
