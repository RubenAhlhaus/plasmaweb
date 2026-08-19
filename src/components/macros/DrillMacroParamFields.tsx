import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MacroCoolantSwitch } from '@/components/macros/MacroCoolantSwitch';
import { MacroFullRetractSwitch } from '@/components/macros/MacroFullRetractSwitch';
import { MacroNumericParamField } from '@/components/macros/MacroNumericParamField';
import {
  MacroParamFieldsLayout,
  useMacroDialogAside,
} from '@/components/macros/MacroParamFieldsLayout';
import {
  macroHintKeyForField,
  omitPatternProvidedFields,
  resolvedMacroParamSections,
  strParam,
  type MacroParamFieldsCommonProps,
} from '@/components/macros/macroParamFieldUtils';
import {
  MacroPresetIdField,
  MacroToolIdField,
  useMacroToolPreset,
} from '@/components/macros/MacroToolPresetFields';
import { MacroFromPatternHint } from '@/components/macros/MacroFromPatternHint';
import { useMacroHintDialogHandlers } from '@/components/macros/useMacroHintDialogHandlers';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import { getMacroHintDefinition } from '@/data/macroHintDefinitions';

type DrillMacroParamFieldsProps = MacroParamFieldsCommonProps;

export function DrillMacroParamFields({
  macroId,
  paramSections,
  tools,
  params,
  setParams,
  setCommitError,
  touchNumericStackProps,
  xyProvidedByPattern = false,
}: DrillMacroParamFieldsProps) {
  const { t } = useTranslation('macros');
  const hintDefinition = getMacroHintDefinition(macroId);
  const { activeHintKey, createNumericDialogOpenHandler, setHoveredHintKey } =
    useMacroHintDialogHandlers(touchNumericStackProps);

  const toolPreset = useMacroToolPreset({
    tools,
    params,
    setParams,
    setCommitError,
    feedKeys: ['feed'],
  });

  const sections = useMemo(() => {
    const resolved = resolvedMacroParamSections(macroId, paramSections);
    return xyProvidedByPattern ? omitPatternProvidedFields(resolved) : resolved;
  }, [macroId, paramSections, xyProvidedByPattern]);

  const hintAriaLabel = hintDefinition ? t(hintDefinition.ariaLabelKey) : '';
  const drillDialogAside = useMacroDialogAside(hintDefinition, activeHintKey, hintAriaLabel);

  const numericFieldProps = {
    params,
    setParams,
    setCommitError,
    dialogAside: drillDialogAside,
    touchNumericStackProps,
    setHoveredHintKey,
    createNumericDialogOpenHandler,
  };

  const renderField = (key: string): ReactNode => {
    switch (key) {
      case 'toolId':
        return (
          <MacroToolIdField
            key={key}
            tools={tools}
            params={params}
            toolOptions={toolPreset.toolOptions}
            onToolChange={toolPreset.onToolChange}
          />
        );
      case 'presetId':
        return (
          <MacroPresetIdField
            key={key}
            presetId={toolPreset.presetId}
            presetOptions={toolPreset.presetOptions}
            selectedTool={toolPreset.selectedTool}
            onPresetChange={toolPreset.onPresetChange}
          />
        );
      case 'spindle':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="spindle"
            label={t('paramLabels.spindle')}
            {...numericFieldProps}
          />
        );
      case 'feed':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="feed"
            label={t('paramLabels.feed')}
            {...numericFieldProps}
          />
        );
      case 'surfaceZ':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="surfaceZ"
            label={t('paramLabels.surfaceZMm')}
            {...numericFieldProps}
          />
        );
      case 'safeZ':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="safeZ"
            label={t('paramLabels.safeZMm')}
            {...numericFieldProps}
          />
        );
      case 'vorschubHoeheMm':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="vorschubHoeheMm"
            label={t('paramLabels.vorschubHoeheMmDrill')}
            hintKey={macroHintKeyForField(hintDefinition, key)}
            hintWrap
            {...numericFieldProps}
          />
        );
      case 'depth':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="depth"
            label={t('paramLabels.depthDrill')}
            hintKey={macroHintKeyForField(hintDefinition, key)}
            hintWrap
            {...numericFieldProps}
          />
        );
      case 'einstechtiefeMm': {
        const depthStr = strParam(params, 'depth').trim();
        const own = strParam(params, 'einstechtiefeMm').trim();
        const display = own === '' ? strParam(params, 'depth') : own;
        return (
          <MacroNumericParamField
            key={key}
            paramKey="einstechtiefeMm"
            label={t('paramLabels.einstechtiefeMm')}
            hintKey={macroHintKeyForField(hintDefinition, key)}
            hintWrap
            value={display}
            onChange={(next) => {
              setCommitError(null);
              const trimmed = next.trim();
              const dNum = parseTouchNumericForCommit(depthStr);
              const eNum = parseTouchNumericForCommit(trimmed);
              const useDepthDefault =
                trimmed === '' ||
                (dNum !== null && eNum !== null && Math.abs(dNum - eNum) < 1e-9);
              setParams((prev) => ({
                ...prev,
                einstechtiefeMm: useDepthDefault ? '' : next,
              }));
            }}
            {...numericFieldProps}
          />
        );
      }
      case 'x':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="x"
            label={t('paramLabels.x')}
            {...numericFieldProps}
          />
        );
      case 'y':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="y"
            label={t('paramLabels.y')}
            {...numericFieldProps}
          />
        );
      case 'coolantOn':
        return (
          <MacroCoolantSwitch
            key={key}
            params={params}
            setParams={setParams}
            setCommitError={setCommitError}
          />
        );
      case 'fullRetract':
        return (
          <MacroFullRetractSwitch
            key={key}
            params={params}
            setParams={setParams}
            setCommitError={setCommitError}
          />
        );
      default:
        if (import.meta.env.DEV) {
          console.warn(`[DrillMacroParamFields] Unknown param key in paramSections: "${key}"`);
        }
        return null;
    }
  };

  return (
    <MacroParamFieldsLayout
      hintDefinition={hintDefinition}
      activeHintKey={activeHintKey}
      hintAriaLabel={hintAriaLabel}
      sections={sections}
      sectionKeyPrefix="drill-section"
      renderField={renderField}
      sectionHeading={(headingKey) => t(headingKey)}
      banner={xyProvidedByPattern ? <MacroFromPatternHint /> : null}
    />
  );
}
