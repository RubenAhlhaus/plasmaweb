import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MacroCoolantSwitch } from '@/components/macros/MacroCoolantSwitch';
import { MacroNumericParamField } from '@/components/macros/MacroNumericParamField';
import {
  MacroParamFieldsLayout,
  useMacroDialogAside,
} from '@/components/macros/MacroParamFieldsLayout';
import {
  resolvedMacroParamSections,
  type MacroParamFieldsCommonProps,
} from '@/components/macros/macroParamFieldUtils';
import {
  MacroPresetIdField,
  MacroToolIdField,
  useMacroToolPreset,
} from '@/components/macros/MacroToolPresetFields';
import { useMacroHintDialogHandlers } from '@/components/macros/useMacroHintDialogHandlers';
import { getMacroHintDefinition } from '@/data/macroHintDefinitions';

type PlanMacroParamFieldsProps = MacroParamFieldsCommonProps;

export function PlanMacroParamFields({
  macroId,
  paramSections,
  tools,
  params,
  setParams,
  setCommitError,
  touchNumericStackProps,
}: PlanMacroParamFieldsProps) {
  const { t } = useTranslation('macros');
  const hintDefinition = getMacroHintDefinition(macroId);
  const { activeHintKey, createNumericDialogOpenHandler, setHoveredHintKey } =
    useMacroHintDialogHandlers(touchNumericStackProps);

  const toolPreset = useMacroToolPreset({
    tools,
    params,
    setParams,
    setCommitError,
    feedKeys: ['feedXY', 'feedZ'],
  });

  const sections = useMemo(
    () => resolvedMacroParamSections(macroId, paramSections),
    [macroId, paramSections],
  );

  const hintAriaLabel = hintDefinition ? t(hintDefinition.ariaLabelKey) : '';
  const planDialogAside = useMacroDialogAside(hintDefinition, activeHintKey, hintAriaLabel);

  const numericFieldProps = {
    params,
    setParams,
    setCommitError,
    dialogAside: planDialogAside,
    touchNumericStackProps,
    setHoveredHintKey,
    createNumericDialogOpenHandler,
  };

  const planHintField = (key: string, label: string) => {
    if (hintDefinition) {
      return (
        <MacroNumericParamField
          key={key}
          paramKey={key}
          label={label}
          hintKey={key}
          {...numericFieldProps}
        />
      );
    }
    return (
      <MacroNumericParamField
        key={key}
        paramKey={key}
        label={label}
        fallbackWrapper
        {...numericFieldProps}
      />
    );
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
      case 'feedXY':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="feedXY"
            label={t('paramLabels.feedXY')}
            {...numericFieldProps}
          />
        );
      case 'feedZ':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="feedZ"
            label={t('paramLabels.feedZ')}
            {...numericFieldProps}
          />
        );
      case 'areaStartX':
        return planHintField(key, t('paramLabels.areaStartX'));
      case 'areaStartY':
        return planHintField(key, t('paramLabels.areaStartY'));
      case 'areaWidth':
        return planHintField(key, t('paramLabels.areaWidthPlan'));
      case 'areaHeight':
        return planHintField(key, t('paramLabels.areaHeightPlan'));
      case 'cutterOverhangMm':
        return planHintField(key, t('paramLabels.cutterOverhangMm'));
      case 'vorschubHoeheMm':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="vorschubHoeheMm"
            label={t('paramLabels.vorschubHoeheMmPlan')}
            {...numericFieldProps}
          />
        );
      case 'surfaceZ':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="surfaceZ"
            label={t('paramLabels.surfaceZ')}
            {...numericFieldProps}
          />
        );
      case 'targetZ':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="targetZ"
            label={t('paramLabels.targetZ')}
            {...numericFieldProps}
          />
        );
      case 'stepOver':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="stepOver"
            label={t('paramLabels.stepOver')}
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
      default:
        if (import.meta.env.DEV) {
          console.warn(`[PlanMacroParamFields] Unknown parameter key in paramSections: "${key}"`);
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
      sectionKeyPrefix="plan-section"
      renderField={renderField}
      sectionHeading={(headingKey) => t(headingKey)}
    />
  );
}
