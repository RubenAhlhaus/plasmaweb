import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TouchSelectField } from '@/components/ui/TouchSelectField';
import { MacroCoolantSwitch } from '@/components/macros/MacroCoolantSwitch';
import { MacroNumericParamField } from '@/components/macros/MacroNumericParamField';
import {
  MacroParamFieldsLayout,
  useMacroDialogAside,
} from '@/components/macros/MacroParamFieldsLayout';
import {
  MACRO_PARAM_FIELD_CLASS,
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
import { getMacroHintDefinition } from '@/data/macroHintDefinitions';

type HelixBoreMacroParamFieldsProps = MacroParamFieldsCommonProps;

export function HelixBoreMacroParamFields({
  macroId,
  paramSections,
  tools,
  params,
  setParams,
  setCommitError,
  touchNumericStackProps,
  xyProvidedByPattern = false,
}: HelixBoreMacroParamFieldsProps) {
  const { t } = useTranslation('macros');
  const millingDirectionOptions = useMemo(
    () => [
      { value: 'climb', label: t('selectOptions.millingDirection.climb') },
      { value: 'conventional', label: t('selectOptions.millingDirection.conventional') },
    ],
    [t],
  );
  const hintDefinition = getMacroHintDefinition(macroId);
  const { activeHintKey, createNumericDialogOpenHandler, setHoveredHintKey } =
    useMacroHintDialogHandlers(touchNumericStackProps);

  const toolPreset = useMacroToolPreset({
    tools,
    params,
    setParams,
    setCommitError,
    feedKeys: ['feedXY'],
  });

  const sections = useMemo(() => {
    const resolved = resolvedMacroParamSections(macroId, paramSections);
    return xyProvidedByPattern ? omitPatternProvidedFields(resolved) : resolved;
  }, [macroId, paramSections, xyProvidedByPattern]);

  const hintAriaLabel = hintDefinition ? t(hintDefinition.ariaLabelKey) : '';
  const helixDialogAside = useMacroDialogAside(hintDefinition, activeHintKey, hintAriaLabel);

  const numericFieldProps = {
    params,
    setParams,
    setCommitError,
    dialogAside: helixDialogAside,
    touchNumericStackProps,
    setHoveredHintKey,
    createNumericDialogOpenHandler,
  };

  const helixHintField = (key: string, label: string) => (
    <MacroNumericParamField
      key={key}
      paramKey={key}
      label={label}
      hintKey={macroHintKeyForField(hintDefinition, key)}
      hintWrap
      {...numericFieldProps}
    />
  );

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
      case 'depth':
        return helixHintField(key, t('paramLabels.holeDepth'));
      case 'x':
        return helixHintField(key, t('paramLabels.holeCenterX'));
      case 'y':
        return helixHintField(key, t('paramLabels.holeCenterY'));
      case 'nominalDiameter':
        return helixHintField(key, t('paramLabels.nominalDiameterBore'));
      case 'helixAngle':
        return (
          <MacroNumericParamField
            key={key}
            paramKey="helixAngle"
            label={t('paramLabels.helixPlungeAngle')}
            {...numericFieldProps}
          />
        );
      case 'millingDirection':
        return (
          <TouchSelectField
            key={key}
            className={MACRO_PARAM_FIELD_CLASS}
            label={t('paramLabels.millingDirection')}
            value={strParam(params, 'millingDirection') || 'climb'}
            onChange={(value) => {
              setCommitError(null);
              setParams((prev) => ({ ...prev, millingDirection: value }));
            }}
            options={millingDirectionOptions}
            dialogTitle={t('paramLabels.millingDirection')}
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
          console.warn(`[HelixBoreMacroParamFields] Unknown parameter key: "${key}"`);
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
      sectionKeyPrefix="helix-section"
      renderField={renderField}
      sectionHeading={(headingKey) => t(headingKey)}
      banner={xyProvidedByPattern ? <MacroFromPatternHint /> : null}
    />
  );
}
