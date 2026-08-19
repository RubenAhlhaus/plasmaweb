import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { MacroDefinition, MacroParams, MacroParamSection } from '@/types/macros';
import type { Tool } from '@/types/tools';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dialogFooterTouchButtonClass } from '@/lib/dialogFormSubmit';
import { TouchNumericDialogFooter, TouchNumericPickerField } from '@/components/numeric';
import { TouchSelectField } from '@/components/ui/TouchSelectField';
import { parseMacroNumberStrict } from '@/lib/macroNumeric';
import { migrateLegacyStartZToSafeZ, strParam } from '@/lib/macroParams';
import {
  defaultPlanFaceTargetZ,
  hasMacroParamValue,
  migratePlanFaceLegacyStepDown,
} from '@/lib/macroGcode/planFaceHeights';
import type { PatternHeightDefaults } from '@/lib/macroGcode/patternHeightDefaults';
import { formatMachineCoordinate } from '@/lib/formatCoordinates';
import { DrillMacroParamFields } from '@/components/macros/DrillMacroParamFields';
import { HelixBoreMacroParamFields } from '@/components/macros/HelixBoreMacroParamFields';
import { PlanMacroParamFields } from '@/components/macros/PlanMacroParamFields';
import { PatternMacroParamFields } from '@/components/macros/PatternMacroParamFields';
import { MacroToggleSwitch } from '@/components/macros/MacroToggleSwitch';
import { validateNestedPatternParamsForSubmit } from '@/components/macros/patternMacroDialogValidation';
import {
  helixBoreSubmitReady,
  validateDrillParamsForSubmit,
  validateGenericParamsForSubmit,
} from '@/components/macros/macroParamDialogValidation';
import { MacroParamSectionHeading } from '@/components/macros/MacroParamSectionHeading';
import {
  NESTED_QUEUE_BLOCK_MACRO_ID,
  BOHREN_NORMAL_MACRO_ID,
  BOHRFRAESEN_MACRO_ID,
  PLAN_FRAESEN_MACRO_ID,
} from '@/data/macroDefinitions';
import { resolveHelixPitchMmPerRev } from '@/lib/macroGcode/helixBoreAngle';
import { useTouchNumericModalEscapeStack } from '@/hooks/useTouchNumericModalEscapeStack';
import { useAppStore } from '@/store';
import { presetMdiValues } from '@/lib/presetMdiValues';
import { ensureCustomPatternPointsJsonHasRowIds } from '@/lib/customPatternPoints';
import { macroDefinitionSubtitle, macroDefinitionTitle } from '@/lib/macroDefinitionLabels';

type MacroParamDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: MacroDefinition | null;
  initialParams?: MacroParams | null;
  mode: 'add' | 'edit';
  onConfirm: (params: MacroParams) => void;
  /** Edit mode only: open delete confirm (parent). */
  onRequestDelete?: () => void;
  /** For tool picker in drill dialog */
  tools?: Tool[];
  /** When adding: pre-selected tool (e.g. active in spindle) */
  activeToolId?: string | null;
  /**
   * Phase inside a drill pattern: hole X/Y and surface Z come from the parent pattern.
   * Hides those fields for drill/helix and skips requiring X/Y on submit.
   */
  xyProvidedByPattern?: boolean;
  /**
   * When adding a nested drill / helix phase: prefill `surfaceZ` and `safeZ`
   * from the parent pattern instead of the machine Z. Nested dialogs hide
   * `surfaceZ` (pattern injects it at expand time); `safeZ` stays editable.
   */
  patternHeightDefaults?: PatternHeightDefaults | null;
};

function mt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'macros', ...options });
}

function paramLabelFromKey(paramKey: string): string {
  return mt(`paramLabels.${paramKey}`, { defaultValue: paramKey });
}

const SELECT_OPTION_KEYS: Record<string, string[]> = {
  processType: ['threadMilling', 'rigidTapping', 'floatingTap'],
  tappingMode: ['rigid', 'floating'],
  threadHand: ['RH', 'LH'],
  pocketType: ['rectangle', 'circle'],
  strategy: ['roughing', 'finishing', 'both'],
  millingDirection: ['climb', 'conventional'],
  millingSide: ['inside', 'outside'],
  direction: ['CW', 'CCW', 'climb', 'conventional'],
  pattern: ['zigzag', 'oneway'],
  pathType: ['edge', 'hole'],
  insideOutside: ['inside', 'outside'],
  contentType: ['text', 'contour'],
  alignment: ['left', 'center', 'right'],
};

function buildSelectOptions(paramKey: string): Array<{ value: string; label: string }> | undefined {
  const vals = SELECT_OPTION_KEYS[paramKey];
  if (!vals) return undefined;
  return vals.map((value) => ({
    value,
    label: mt(`selectOptions.${paramKey}.${value}`),
  }));
}

type MachineCoordinates = { x: number; y: number; z: number };

function normalizeLegacyToolId(next: MacroParams, toolsNow: Tool[]): void {
  const legacyTool = next.tool;
  delete next.tool;
  if (!String(next.toolId ?? '').trim() && typeof legacyTool === 'number') {
    const t = toolsNow.find((x) => x.toolNumber === legacyTool);
    if (t) next.toolId = t.id;
  }
}

function normalizeStringFields(next: MacroParams, keys: readonly string[]): void {
  for (const k of keys) {
    const v = next[k];
    next[k] = v === undefined || v === null ? '' : String(v);
  }
}

function normalizeBooleanField(next: MacroParams, key: string): void {
  next[key] =
    next[key] === true ||
    next[key] === 'true' ||
    String(next[key]).toLowerCase() === 'true';
}

function normalizeNumericFieldOrDefault(next: MacroParams, key: string, fallback: number): void {
  const raw = next[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    next[key] = fallback;
    return;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    next[key] = raw;
    return;
  }
  const parsed = parseMacroNumberStrict(raw);
  next[key] = parsed ?? fallback;
}

function resolvePreferredToolId(
  currentToolId: string,
  toolsNow: Tool[],
  activeToolId: string | null,
): string {
  if (currentToolId.trim()) return currentToolId;
  if (toolsNow.length === 0) return '';
  if (activeToolId && toolsNow.some((t) => t.id === activeToolId)) return activeToolId;
  return toolsNow[0].id;
}

function formatMachineCoordinates(coordinates: MachineCoordinates): {
  x: string;
  y: string;
  z: string;
} {
  return {
    x: Number.isFinite(coordinates.x) ? formatMachineCoordinate(coordinates.x) : '',
    y: Number.isFinite(coordinates.y) ? formatMachineCoordinate(coordinates.y) : '',
    z: Number.isFinite(coordinates.z) ? formatMachineCoordinate(coordinates.z) : '',
  };
}

export function buildPlanDialogInitialParams(args: {
  definition: MacroDefinition;
  initialParams?: MacroParams | null;
  toolsNow: Tool[];
  activeToolId: string | null;
  coordinates: MachineCoordinates;
}): MacroParams {
  const { definition, initialParams, toolsNow, activeToolId, coordinates } = args;
  const next: MacroParams = {
    ...definition.defaultParams,
    ...(initialParams ?? {}),
  };

  normalizeLegacyToolId(next, toolsNow);
  normalizeStringFields(next, [
    'toolId',
    'presetId',
    'spindle',
    'feedXY',
    'feedZ',
    'areaStartX',
    'areaStartY',
    'areaWidth',
    'areaHeight',
    'cutterOverhangMm',
    'vorschubHoeheMm',
    'targetZ',
    'stepOver',
  ]);
  normalizeNumericFieldOrDefault(next, 'surfaceZ', 0);
  const migratedFromStepDown = migratePlanFaceLegacyStepDown(next, initialParams ?? null);
  if (hasMacroParamValue(initialParams, 'targetZ')) {
    normalizeNumericFieldOrDefault(next, 'targetZ', defaultPlanFaceTargetZ(0));
  } else if (!migratedFromStepDown) {
    const surface =
      typeof next.surfaceZ === 'number'
        ? next.surfaceZ
        : parseMacroNumberStrict(String(next.surfaceZ ?? '')) ?? 0;
    next.targetZ = defaultPlanFaceTargetZ(surface);
  }
  normalizeBooleanField(next, 'coolantOn');

  if (!initialParams) {
    next.toolId = resolvePreferredToolId(String(next.toolId ?? ''), toolsNow, activeToolId);
    const machine = formatMachineCoordinates(coordinates);
    next.areaStartX = machine.x;
    next.areaStartY = machine.y;
    if (machine.z !== '') {
      const parsedZ = parseMacroNumberStrict(machine.z);
      if (parsedZ !== null) {
        next.surfaceZ = parsedZ;
        next.targetZ = defaultPlanFaceTargetZ(parsedZ);
      }
    }
  }

  return next;
}

export function buildDrillDialogInitialParams(args: {
  definition: MacroDefinition;
  initialParams?: MacroParams | null;
  toolsNow: Tool[];
  activeToolId: string | null;
  coordinates: MachineCoordinates;
  xyProvidedByPattern?: boolean;
  patternHeightDefaults?: PatternHeightDefaults | null;
}): MacroParams {
  const {
    definition,
    initialParams,
    toolsNow,
    activeToolId,
    coordinates,
    xyProvidedByPattern = false,
    patternHeightDefaults = null,
  } = args;
  const next: MacroParams = {
    ...definition.defaultParams,
    ...(initialParams ?? {}),
  };
  migrateLegacyStartZToSafeZ(next);
  normalizeLegacyToolId(next, toolsNow);
  normalizeStringFields(next, [
    'toolId',
    'presetId',
    'spindle',
    'feed',
    'safeZ',
    'depth',
    'einstechtiefeMm',
    'vorschubHoeheMm',
    'x',
    'y',
  ]);
  normalizeNumericFieldOrDefault(next, 'surfaceZ', 0);
  normalizeBooleanField(next, 'coolantOn');
  normalizeBooleanField(next, 'fullRetract');

  if (!initialParams) {
    next.toolId = resolvePreferredToolId(String(next.toolId ?? ''), toolsNow, activeToolId);
    const machine = formatMachineCoordinates(coordinates);
    if (!xyProvidedByPattern) {
      next.x = machine.x;
      next.y = machine.y;
    }
    if (xyProvidedByPattern && patternHeightDefaults) {
      next.surfaceZ = patternHeightDefaults.surfaceZ;
      next.safeZ = String(patternHeightDefaults.safeZ);
    } else {
      next.safeZ = machine.z;
    }
  }

  return next;
}

export function buildHelixBoreDialogInitialParams(args: {
  definition: MacroDefinition;
  initialParams?: MacroParams | null;
  toolsNow: Tool[];
  activeToolId: string | null;
  coordinates: MachineCoordinates;
  xyProvidedByPattern?: boolean;
  patternHeightDefaults?: PatternHeightDefaults | null;
}): MacroParams {
  const {
    definition,
    initialParams,
    toolsNow,
    activeToolId,
    coordinates,
    xyProvidedByPattern = false,
    patternHeightDefaults = null,
  } = args;
  const next: MacroParams = {
    ...definition.defaultParams,
    ...(initialParams ?? {}),
  };
  migrateLegacyStartZToSafeZ(next);
  normalizeLegacyToolId(next, toolsNow);
  normalizeStringFields(next, [
    'toolId',
    'presetId',
    'spindle',
    'feedXY',
    'safeZ',
    'depth',
    'x',
    'y',
    'nominalDiameter',
  ]);
  normalizeNumericFieldOrDefault(next, 'surfaceZ', 0);

  const ha = next.helixAngle;
  next.helixAngle =
    ha === undefined || ha === null || String(ha).trim() === ''
      ? (definition.defaultParams.helixAngle as number)
      : typeof ha === 'number' && Number.isFinite(ha)
        ? ha
        : (parseMacroNumberStrict(ha) ?? (definition.defaultParams.helixAngle as number));

  normalizeBooleanField(next, 'coolantOn');

  if (!String(next.millingDirection ?? '').trim()) {
    next.millingDirection = 'climb';
  }

  if (!initialParams) {
    next.toolId = resolvePreferredToolId(String(next.toolId ?? ''), toolsNow, activeToolId);
    const machine = formatMachineCoordinates(coordinates);
    if (!xyProvidedByPattern) {
      next.x = machine.x;
      next.y = machine.y;
    }
    if (xyProvidedByPattern && patternHeightDefaults) {
      next.surfaceZ = patternHeightDefaults.surfaceZ;
      next.safeZ = String(patternHeightDefaults.safeZ);
    } else {
      next.safeZ = machine.z;
    }
  }

  return next;
}

type GenericParamSectionBlock = { headingKey: string | null; keys: string[] };

/**
 * Visible keys from `paramSections`; remainder at the end without a heading,
 * in `visibleEntries` order.
 */
function buildGenericParamSectionBlocks(
  definition: MacroDefinition,
  visibleEntries: Array<[string, string | number | boolean]>,
): GenericParamSectionBlock[] {
  const visibleKeySet = new Set(visibleEntries.map(([k]) => k));
  const sections: MacroParamSection[] | undefined = definition.paramSections;

  if (!sections?.length) {
    return [{ headingKey: null, keys: visibleEntries.map(([k]) => k) }];
  }

  const used = new Set<string>();
  const blocks: GenericParamSectionBlock[] = [];

  for (const s of sections) {
    const keys = s.keys.filter((k) => visibleKeySet.has(k));
    keys.forEach((k) => used.add(k));
    if (keys.length === 0) continue;
    const hk = s.headingKey.trim();
    blocks.push({ headingKey: hk.length > 0 ? hk : null, keys });
  }

  const leftovers = visibleEntries.map(([k]) => k).filter((k) => !used.has(k));
  if (leftovers.length > 0) {
    blocks.push({ headingKey: null, keys: leftovers });
  }

  return blocks;
}

function ParamInput({
  paramKey,
  value,
  onChange,
  isNumeric,
  className,
  touchNumericStackProps,
  tools = [],
  selectedToolId = '',
  selectedToolPresets = [],
  onToolChange,
  onPresetChange,
}: {
  paramKey: string;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  isNumeric: boolean;
  className?: string;
  touchNumericStackProps?: { onDialogOpenChange?: (open: boolean) => void };
  tools?: Tool[];
  selectedToolId?: string;
  selectedToolPresets?: Array<{ value: string; label: string }>;
  onToolChange?: (toolId: string) => void;
  onPresetChange?: (presetId: string) => void;
}) {
  const { t } = useTranslation('macros');
  const label = paramLabelFromKey(paramKey);
  if (paramKey === 'toolId') {
    const toolOptions = tools.map((t) => ({
      value: t.id,
      label: t.toolNumber != null && t.toolNumber > 0 ? `T${t.toolNumber}${t.name ? ` — ${t.name}` : ''}` : t.name || t.id,
    }));
    return (
      <TouchSelectField
        className={className}
        label={label}
        value={selectedToolId}
        onChange={(toolId) => (onToolChange ? onToolChange(toolId) : onChange(toolId))}
        options={toolOptions}
        dialogTitle={t('dialog.selectTool')}
        triggerClassName="h-14 min-h-14 py-0"
        disabled={tools.length === 0}
      />
    );
  }

  if (paramKey === 'presetId') {
    return (
      <TouchSelectField
        className={className}
        label={label}
        value={strParam({ presetId: value }, 'presetId')}
        onChange={(presetId) => (onPresetChange ? onPresetChange(presetId) : onChange(presetId))}
        options={selectedToolPresets}
        allowEmpty
        emptyLabel={t('dialog.emptyPreset')}
        dialogTitle={t('dialog.selectPreset')}
        triggerClassName="h-14 min-h-14 py-0"
        disabled={!selectedToolId}
      />
    );
  }

  const selectOptions = buildSelectOptions(paramKey);
  if (selectOptions) {
    return (
      <TouchSelectField
        className={className}
        label={label}
        value={strParam({ [paramKey]: value }, paramKey)}
        onChange={(nextVal) => onChange(nextVal)}
        options={selectOptions}
        dialogTitle={t('dialog.pickField', { label })}
        triggerClassName="h-14 min-h-14 py-0"
      />
    );
  }

  if (typeof value === 'boolean') {
    return (
      <MacroToggleSwitch
        checked={value}
        label={label}
        ariaLabelOn={t('dialog.switchOn', { label })}
        ariaLabelOff={t('dialog.switchOff', { label })}
        onCheckedChange={() => onChange(!value)}
        className={className}
      />
    );
  }
  if (isNumeric) {
    const text = String(value);
    return (
      <TouchNumericPickerField
        {...(touchNumericStackProps ?? {})}
        value={text}
        onChange={(t) => onChange(t)}
        label={label}
        dialogTitle={label}
        triggerClassName="h-14 min-h-14 py-0"
        className={cn('min-w-0 w-full', className)}
      />
    );
  }
  return (
    <div className={cn('space-y-1 min-w-0 w-full', className)}>
      <label className="text-sm text-muted-foreground whitespace-nowrap">{label}</label>
      <input
        type="text"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full h-14 rounded-md border border-input bg-background/80 px-3',
          'text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring'
        )}
      />
    </div>
  );
}

export function MacroParamDialog({
  open,
  onOpenChange,
  definition,
  initialParams,
  mode,
  onConfirm,
  onRequestDelete,
  tools = [],
  activeToolId = null,
  xyProvidedByPattern = false,
  patternHeightDefaults = null,
}: MacroParamDialogProps) {
  const { t } = useTranslation('macros');
  const [params, setParams] = useState<MacroParams>({});
  const [commitError, setCommitError] = useState<string | null>(null);

  const { onOuterEscapeKeyDown, touchNumericStackProps } = useTouchNumericModalEscapeStack({
    outerOpen: open,
  });

  /** Current tools / active tool for initialization only — not in reset deps, or selection would jump on every status update. */
  const toolsRef = useRef(tools);
  const activeToolIdRef = useRef(activeToolId);
  toolsRef.current = tools;
  activeToolIdRef.current = activeToolId;

  /** Voller Reset nur bei Dialog/Definition/Edit-Payload — nicht bei jedem Poll von `activeToolId` oder neuer `tools`-Referenz. */
  useEffect(() => {
    if (!open || !definition) return;

    if (definition.id === BOHREN_NORMAL_MACRO_ID) {
      setParams(
        buildDrillDialogInitialParams({
          definition,
          initialParams,
          toolsNow: toolsRef.current,
          activeToolId: activeToolIdRef.current,
          coordinates: useAppStore.getState().coordinates,
          xyProvidedByPattern,
          patternHeightDefaults,
        }),
      );
      setCommitError(null);
      return;
    }

    if (definition.id === BOHRFRAESEN_MACRO_ID) {
      setParams(
        buildHelixBoreDialogInitialParams({
          definition,
          initialParams,
          toolsNow: toolsRef.current,
          activeToolId: activeToolIdRef.current,
          coordinates: useAppStore.getState().coordinates,
          xyProvidedByPattern,
          patternHeightDefaults,
        }),
      );
      setCommitError(null);
      return;
    }

    if (definition.id === PLAN_FRAESEN_MACRO_ID) {
      const next = buildPlanDialogInitialParams({
        definition,
        initialParams,
        toolsNow: toolsRef.current,
        activeToolId: activeToolIdRef.current,
        coordinates: useAppStore.getState().coordinates,
      });

      setParams(next);
      setCommitError(null);
      return;
    }

    const base = initialParams ?? definition.defaultParams;
    const merged = { ...definition.defaultParams, ...base };
    if (definition.id === NESTED_QUEUE_BLOCK_MACRO_ID) {
      const pt = String(merged.patternType ?? '');
      if (pt === 'cartesian') merged.patternType = 'rectangular';
      if (pt === 'polar') merged.patternType = 'round';
      if (!['custom', 'round', 'rectangular'].includes(String(merged.patternType))) {
        merged.patternType = 'rectangular';
      }
      if (!String(merged.customPatternPoints ?? '').trim()) {
        merged.customPatternPoints = '[{"x":0,"y":0}]';
      }
      merged.customPatternPoints = ensureCustomPatternPointsJsonHasRowIds(
        String(merged.customPatternPoints ?? ''),
      );
      delete merged.applyToMacro;
      delete merged.safeZ;
      delete merged.moveToClearanceEachHole;
    }
    setParams(merged);
    setCommitError(null);
  }, [
    open,
    definition,
    initialParams,
    xyProvidedByPattern,
    patternHeightDefaults?.surfaceZ,
    patternHeightDefaults?.safeZ,
  ]);

  /** New entry: tool list arrives after open — backfill only while `toolId` is still empty (`activeToolId` intentionally via ref only, no re-set on spindle change). */
  useEffect(() => {
    if (!open || !definition || initialParams != null) {
      return;
    }
    if (
      definition.id !== BOHREN_NORMAL_MACRO_ID &&
      definition.id !== BOHRFRAESEN_MACRO_ID &&
      definition.id !== PLAN_FRAESEN_MACRO_ID
    ) {
      return;
    }
    setParams((prev) => {
      if (String(prev.toolId ?? '').trim()) return prev;
      if (tools.length === 0) return prev;
      const at = activeToolIdRef.current;
      const pick = at && tools.some((t) => t.id === at) ? at : tools[0].id;
      return { ...prev, toolId: pick };
    });
  }, [open, definition, initialParams, tools]);

  const handleConfirm = () => {
    if (!definition) return;

    if (definition.id === BOHREN_NORMAL_MACRO_ID) {
      const result = validateDrillParamsForSubmit(params, tools, xyProvidedByPattern);
      if (!result.ok) {
        setCommitError(result.message);
        return;
      }
      setCommitError(null);
      onConfirm(result.resolved);
      onOpenChange(false);
      return;
    }

    if (definition.id === NESTED_QUEUE_BLOCK_MACRO_ID) {
      const result = validateNestedPatternParamsForSubmit(definition, params);
      if (!result.ok) {
        setCommitError(result.message);
        return;
      }
      setCommitError(null);
      onConfirm(result.resolved);
      onOpenChange(false);
      return;
    }

    if (definition.id === BOHRFRAESEN_MACRO_ID) {
      const result = validateGenericParamsForSubmit(definition, params, tools, xyProvidedByPattern);
      if (!result.ok) {
        setCommitError(result.message);
        return;
      }
      const d = Number(result.resolved.nominalDiameter);
      const pitchRes = resolveHelixPitchMmPerRev(d, result.resolved.helixAngle);
      if (!pitchRes.ok) {
        setCommitError(
          pitchRes.code === 'angle_range'
            ? mt('validation.helixAngleRange')
            : mt('validation.helixPitchInvalid'),
        );
        return;
      }
      setCommitError(null);
      onConfirm(result.resolved);
      onOpenChange(false);
      return;
    }

    const result = validateGenericParamsForSubmit(definition, params, tools);
    if (!result.ok) {
      setCommitError(result.message);
      return;
    }
    setCommitError(null);
    onConfirm(result.resolved);
    onOpenChange(false);
  };

  const isConfirmPrimaryVariant = (() => {
    if (!definition) return true;
    if (definition.id === BOHREN_NORMAL_MACRO_ID) {
      return validateDrillParamsForSubmit(params, tools, xyProvidedByPattern).ok;
    }
    if (definition.id === NESTED_QUEUE_BLOCK_MACRO_ID) {
      return validateNestedPatternParamsForSubmit(definition, params).ok;
    }
    if (definition.id === BOHRFRAESEN_MACRO_ID) {
      return helixBoreSubmitReady(definition, params, tools, xyProvidedByPattern);
    }
    return validateGenericParamsForSubmit(definition, params, tools).ok;
  })();

  if (!definition) return null;

  const dialogTitleBase =
    definition.id === NESTED_QUEUE_BLOCK_MACRO_ID
      ? macroDefinitionTitle(definition, t)
      : macroDefinitionSubtitle(definition, t) || macroDefinitionTitle(definition, t);
  const title =
    mode === 'add' ? t('dialog.add', { name: dialogTitleBase }) : t('dialog.edit', { name: dialogTitleBase });

  const isDrillDialog = definition.id === BOHREN_NORMAL_MACRO_ID;
  const isHelixBoreDialog = definition.id === BOHRFRAESEN_MACRO_ID;
  const isPlanDialog = definition.id === PLAN_FRAESEN_MACRO_ID;
  const isPositionPatternNestedDialog = definition.id === NESTED_QUEUE_BLOCK_MACRO_ID;
  const selectedTool = tools.find((t) => t.id === strParam(params, 'toolId'));
  const selectedToolPresets = (selectedTool?.lcncguiPresets ?? []).map((p) => ({
    value: p.id,
    label: p.name || p.id,
  }));

  const handleToolChangeGeneric = (toolId: string) => {
    setCommitError(null);
    setParams((prev) => {
      const next: MacroParams = { ...prev, toolId, presetId: '' };
      if ('spindle' in next) next.spindle = '';
      if ('feed' in next) next.feed = '';
      if ('feedXY' in next) next.feedXY = '';
      return next;
    });
  };

  const handlePresetChangeGeneric = (presetId: string) => {
    setCommitError(null);
    setParams((prev) => {
      const next: MacroParams = { ...prev, presetId };
      const preset = selectedTool?.lcncguiPresets?.find((p) => p.id === presetId);
      const mdi = presetMdiValues(preset);
      if (!presetId) {
        if ('spindle' in next) next.spindle = '';
        if ('feed' in next) next.feed = '';
        if ('feedXY' in next) next.feedXY = '';
      } else if (mdi) {
        if ('spindle' in next) next.spindle = String(mdi.s);
        if ('feed' in next) next.feed = String(mdi.f);
        if ('feedXY' in next) next.feedXY = String(mdi.f);
      }
      return next;
    });
  };

  const visibleParamEntries = Object.entries(params);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        onEscapeKeyDown={onOuterEscapeKeyDown}
        className={
          isDrillDialog || isHelixBoreDialog || isPlanDialog || isPositionPatternNestedDialog
            ? 'max-w-6xl w-[min(100vw-1.5rem,72rem)] max-h-[90vh] overflow-y-auto'
            : 'max-w-4xl w-[min(100vw-1.5rem,52rem)] max-h-[90vh] overflow-y-auto'
        }
      >
        <div className="space-y-6">
          {isDrillDialog ? (
            <DrillMacroParamFields
              macroId={definition.id}
              paramSections={definition.paramSections}
              tools={tools}
              params={params}
              setParams={setParams}
              setCommitError={setCommitError}
              touchNumericStackProps={touchNumericStackProps}
              xyProvidedByPattern={xyProvidedByPattern}
            />
          ) : isHelixBoreDialog ? (
            <HelixBoreMacroParamFields
              macroId={definition.id}
              paramSections={definition.paramSections}
              tools={tools}
              params={params}
              setParams={setParams}
              setCommitError={setCommitError}
              touchNumericStackProps={touchNumericStackProps}
              xyProvidedByPattern={xyProvidedByPattern}
            />
          ) : isPlanDialog ? (
            <PlanMacroParamFields
              macroId={definition.id}
              paramSections={definition.paramSections}
              tools={tools}
              params={params}
              setParams={setParams}
              setCommitError={setCommitError}
              touchNumericStackProps={touchNumericStackProps}
            />
          ) : isPositionPatternNestedDialog ? (
            <PatternMacroParamFields
              definition={definition}
              params={params}
              setParams={setParams}
              setCommitError={setCommitError}
              touchNumericStackProps={touchNumericStackProps}
            />
          ) : (
            <div className="space-y-6">
              {buildGenericParamSectionBlocks(definition, visibleParamEntries).map((block, blockIdx) => (
                <div key={`${block.headingKey ?? 'block'}-${blockIdx}`} className="space-y-3">
                  {block.headingKey ? (
                    <MacroParamSectionHeading>{t(block.headingKey)}</MacroParamSectionHeading>
                  ) : null}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
                    {block.keys.map((key) => {
                      const value = params[key];
                      if (value === undefined) return null;
                      return (
                        <ParamInput
                          key={key}
                          className="min-w-0 w-full"
                          paramKey={key}
                          value={value}
                          isNumeric={typeof definition.defaultParams[key] === 'number'}
                          touchNumericStackProps={touchNumericStackProps}
                          tools={tools}
                          selectedToolId={strParam(params, 'toolId')}
                          selectedToolPresets={selectedToolPresets}
                          onToolChange={handleToolChangeGeneric}
                          onPresetChange={handlePresetChangeGeneric}
                          onChange={(newVal) => {
                            setCommitError(null);
                            setParams((prev) => ({ ...prev, [key]: newVal }));
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {commitError ? (
          <p className="text-sm text-destructive mt-2 px-1" role="alert">
            {commitError}
          </p>
        ) : null}
        {mode === 'edit' && onRequestDelete ? (
          <div className="mt-4 pt-4 border-t border-border/50">
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className={cn(dialogFooterTouchButtonClass, 'w-full min-w-0')}
              onClick={onRequestDelete}
              data-e2e="macros-param-dialog-delete"
            >
              {t('dialog.delete')}
            </Button>
          </div>
        ) : null}
        <TouchNumericDialogFooter
          onCancel={() => onOpenChange(false)}
          onConfirm={handleConfirm}
          cancelLabel={t('dialog.cancel')}
          confirmLabel={t('dialog.ok')}
          confirmVariant={isConfirmPrimaryVariant ? 'default' : 'secondary'}
        />
      </DialogContent>
    </Dialog>
  );
}
