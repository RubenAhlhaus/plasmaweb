import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TouchSelectField } from '@/components/ui/TouchSelectField';
import type { Tool, ToolPreset } from '@/types/tools';
import { ToolPresetEditDialog } from '@/components/tools/ToolPresetEditDialog';
import {
  ALL_TOOL_TYPES,
  normalizeToolMaterial,
  TOOL_MATERIAL_I18N_KEY,
  TOOL_MATERIAL_VALUES,
} from '@/types/tools';
import { TouchNumericPickerField, touchNumericDialogFooterGridClassName } from '@/components/numeric';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import {
  TOOL_ADD_TOOL_TABLE_ROW_ACTION,
  TOOL_UPDATE_TOOL_TABLE_ROW_ACTION,
  type UpdateToolTableRowParams,
} from '@/api/toolTableCommands';
import type { CoordinateAxisKey } from '@/api/coordinateSystems';
import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { useToolMachineUiProfile } from '@/hooks/useToolMachineUiProfile';
import { useTouchNumericModalEscapeStack } from '@/hooks/useTouchNumericModalEscapeStack';
import { parsePlasmawebMeta } from '@/lib/plasmawebToolComment';
import { dialogFooterTouchButtonClass } from '@/lib/dialogFormSubmit';
import { toolFormInputClass, toolFormTouchSelectTriggerClass } from '@/lib/toolFormTouchClasses';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { InterpState } from '@/store/types';

type ToolEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: Tool | null;
  /** Default: `edit` when `tool` is set, else `create`. */
  mode?: 'edit' | 'create';
  /** For duplicate check when creating (LinuxCNC T numbers). */
  occupiedToolNumbers?: number[];
  /** Suggested T number in create dialog. */
  suggestedToolNumber?: number;
  /** After successful rename (T number changed), e.g. refresh table selection. */
  onSuccessfulToolNumberChange?: (newToolId: string) => void;
};

function parsePositiveToolNumberFromInput(s: string): number | undefined {
  const t = s.trim();
  const m = /^T\s*(\d+)$/i.exec(t) ?? /^(\d+)$/.exec(t);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : undefined;
}

function parseOptionalFloat(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Non-negative integers only (no silent acceptance of prefixes like `4x`). */
function parseOptionalInt(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  if (!/^\d+$/.test(t)) return undefined;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

function optionalNumField(
  key: keyof UpdateToolTableRowParams,
  v: number | undefined,
  out: UpdateToolTableRowParams,
) {
  if (v !== undefined) {
    (out as Record<string, unknown>)[key] = v;
  }
}

export function ToolEditDialog({
  open,
  onOpenChange,
  tool,
  mode: modeProp,
  occupiedToolNumbers = [],
  suggestedToolNumber = 1,
  onSuccessfulToolNumberChange,
}: ToolEditDialogProps) {
  const { t } = useTranslation('tools');
  const sendCommand = useSendCommand();
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const interpState = useAppStore((s) => s.linuxCncStatus.program.interp_state);
  const { activeAxes, showLatheGeometry } = useToolMachineUiProfile();

  const interpreterIdle =
    interpState === undefined || interpState === InterpState.INTERP_IDLE;

  const mode: 'edit' | 'create' =
    modeProp ?? (tool != null ? 'edit' : 'create');

  const [toolNumberInput, setToolNumberInput] = useState('');
  const [pocket, setPocket] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [z, setZ] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [u, setU] = useState('');
  const [v, setV] = useState('');
  const [w, setW] = useState('');
  const [diameter, setDiameter] = useState('');
  const [frontAngle, setFrontAngle] = useState('');
  const [backAngle, setBackAngle] = useState('');
  const [orientation, setOrientation] = useState<string>('');
  const [metaName, setMetaName] = useState('');
  const [metaType, setMetaType] = useState('');
  const [metaMaterial, setMetaMaterial] = useState('');
  const [metaComment, setMetaComment] = useState('');
  const [metaNumberOfFlutes, setMetaNumberOfFlutes] = useState('');
  const [metaFlutesLength, setMetaFlutesLength] = useState('');
  const [localPresets, setLocalPresets] = useState<ToolPreset[]>([]);
  type PresetEditorTarget = { mode: 'edit'; index: number } | { mode: 'new' };
  const [presetTarget, setPresetTarget] = useState<PresetEditorTarget | null>(null);

  const { onOuterEscapeKeyDown: handleToolEditEscapeKeyDown, touchNumericStackProps } =
    useTouchNumericModalEscapeStack({
      outerOpen: open,
      blockOuterEscape: presetTarget !== null,
    });

  const pendingCommandIdRef = useRef<string | null>(null);
  /** After save with changed T number: `T{n}` for success callback. */
  const pendingRenamedToToolIdRef = useRef<string | null>(null);
  /** Avoid re-hydrating on every status poll (new `tool` object, same id). */
  const lastHydratedToolIdRef = useRef<string | null>(null);
  /** Create mode: set fields once per opened session. */
  const createFormInitializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      pendingCommandIdRef.current = null;
      pendingRenamedToToolIdRef.current = null;
      lastHydratedToolIdRef.current = null;
      createFormInitializedRef.current = false;
    }
  }, [open]);

  usePendingWsCommandResult(pendingCommandIdRef, {
    enabled: open,
    onResult: (r) => {
      pendingCommandIdRef.current = null;
      if (r.ok) {
        if (r.result?.toolTableReloadDeferred === true) {
          showErrorToast({
            tone: 'info',
            kind: t('toolEdit.toastToolTableKind'),
            message: t('toolEdit.toastReloadDeferred'),
          });
        }
        const renamed = pendingRenamedToToolIdRef.current;
        pendingRenamedToToolIdRef.current = null;
        if (renamed != null) {
          onSuccessfulToolNumberChange?.(renamed);
        }
        onOpenChange(false);
      } else {
        pendingRenamedToToolIdRef.current = null;
      }
    },
  });

  // Reset create form before paint — avoids races with fast typing / E2E.
  useLayoutEffect(() => {
    if (!open || mode !== 'create') return;
    if (createFormInitializedRef.current) return;
    createFormInitializedRef.current = true;
    lastHydratedToolIdRef.current = '__create__';
    const sug = suggestedToolNumber > 0 ? suggestedToolNumber : 1;
    setToolNumberInput(String(sug));
    setPocket(String(sug));
    setX('');
    setY('');
    setZ('');
    setA('');
    setB('');
    setC('');
    setU('');
    setV('');
    setW('');
    setDiameter('');
    setFrontAngle('');
    setBackAngle('');
    setOrientation('');
    setMetaName('');
    setMetaType('');
    setMetaMaterial('');
    setMetaComment('');
    setMetaNumberOfFlutes('');
    setMetaFlutesLength('');
    setLocalPresets([]);
  }, [open, mode, suggestedToolNumber]);

  useEffect(() => {
    if (!open || mode !== 'edit' || !tool) return;
    // Once per open dialog / tool change — not on every poll.
    if (lastHydratedToolIdRef.current === tool.id) return;
    lastHydratedToolIdRef.current = tool.id;

    const raw = tool.rawTableComment ?? '';
    const meta = parsePlasmawebMeta(raw);
    setMetaName(meta?.name ?? tool.name);
    setMetaType(meta?.type ?? tool.type ?? '');
    setMetaMaterial(normalizeToolMaterial(meta?.material ?? tool.material ?? ''));
    // `tool.comment` from mapper (raw comment + sidecar `lcncgui_meta`) — same as list.
    // Not `!raw && tool.comment`: with a non-empty short comment without `|LCNCGUI|` the field would stay empty.
    setMetaComment(
      meta?.comment != null && String(meta.comment).trim() !== ''
        ? String(meta.comment).trim()
        : (tool.comment ?? ''),
    );
    setMetaNumberOfFlutes(tool.numberOfFlutes != null ? String(tool.numberOfFlutes) : '');
    setMetaFlutesLength(tool.flutesLength != null ? String(tool.flutesLength) : '');
    setPocket(tool.pocketNumber != null ? String(tool.pocketNumber) : '');
    setX(tool.offsetX != null ? String(tool.offsetX) : '');
    setY(tool.offsetY != null ? String(tool.offsetY) : '');
    setZ(tool.offsetZ != null ? String(tool.offsetZ) : '');
    setA(tool.offsetA != null ? String(tool.offsetA) : '');
    setB(tool.offsetB != null ? String(tool.offsetB) : '');
    setC(tool.offsetC != null ? String(tool.offsetC) : '');
    setU(tool.offsetU != null ? String(tool.offsetU) : '');
    setV(tool.offsetV != null ? String(tool.offsetV) : '');
    setW(tool.offsetW != null ? String(tool.offsetW) : '');
    setDiameter(tool.diameter != null ? String(tool.diameter) : '');
    setFrontAngle(tool.frontAngle != null ? String(tool.frontAngle) : '');
    setBackAngle(tool.backAngle != null ? String(tool.backAngle) : '');
    setOrientation(
      tool.toolOrientation != null && tool.toolOrientation >= 1 && tool.toolOrientation <= 4
        ? String(tool.toolOrientation)
        : '',
    );
    setLocalPresets(tool.lcncguiPresets?.map((p) => ({ ...p })) ?? []);
    setToolNumberInput(
      tool.toolNumber != null && tool.toolNumber > 0 ? String(tool.toolNumber) : '',
    );
  }, [open, mode, tool]);

  const handleSave = useCallback(() => {
    const lcncgui_meta: Record<string, string | number> = {};
    if (metaName.trim()) lcncgui_meta.name = metaName.trim();
    if (metaType.trim()) lcncgui_meta.type = metaType.trim();
    const mat = normalizeToolMaterial(metaMaterial);
    if (mat !== '') lcncgui_meta.material = mat;
    if (metaComment.trim()) lcncgui_meta.comment = metaComment.trim();
    const nf = parseOptionalInt(metaNumberOfFlutes);
    if (nf !== undefined) lcncgui_meta.numberOfFlutes = nf;
    const fl = parseOptionalFloat(metaFlutesLength);
    if (fl !== undefined) lcncgui_meta.flutesLength = fl;

    let toolno: number;
    let editTargetNo: number | undefined;
    pendingRenamedToToolIdRef.current = null;
    if (mode === 'create') {
      const n = parsePositiveToolNumberFromInput(toolNumberInput);
      if (n == null) return;
      if (occupiedToolNumbers.includes(n)) return;
      toolno = n;
    } else {
      if (!tool?.toolNumber || tool.toolNumber <= 0) return;
      toolno = tool.toolNumber;
      const target = parsePositiveToolNumberFromInput(toolNumberInput);
      if (target == null) return;
      if (target !== tool.toolNumber && occupiedToolNumbers.includes(target)) return;
      editTargetNo = target;
    }

    const params: UpdateToolTableRowParams = {
      toolno,
      lcncgui_meta,
      lcncgui_presets: localPresets.map((pr) => ({ ...pr })),
    };

    if (
      mode === 'edit' &&
      editTargetNo != null &&
      tool != null &&
      tool.toolNumber != null &&
      editTargetNo !== tool.toolNumber
    ) {
      params.new_toolno = editTargetNo;
      pendingRenamedToToolIdRef.current = `T${editTargetNo}`;
    }

    optionalNumField('pocket', parseOptionalFloat(pocket), params);
    optionalNumField('diameter', parseOptionalFloat(diameter), params);
    optionalNumField('xoffset', parseOptionalFloat(x), params);
    optionalNumField('yoffset', parseOptionalFloat(y), params);
    optionalNumField('zoffset', parseOptionalFloat(z), params);
    optionalNumField('aoffset', parseOptionalFloat(a), params);
    optionalNumField('boffset', parseOptionalFloat(b), params);
    optionalNumField('coffset', parseOptionalFloat(c), params);
    optionalNumField('uoffset', parseOptionalFloat(u), params);
    optionalNumField('voffset', parseOptionalFloat(v), params);
    optionalNumField('woffset', parseOptionalFloat(w), params);
    optionalNumField('frontangle', parseOptionalFloat(frontAngle), params);
    optionalNumField('backangle', parseOptionalFloat(backAngle), params);
    const ori = parseOptionalFloat(orientation);
    if (ori !== undefined && ori >= 1 && ori <= 4) {
      params.orientation = ori;
    }

    const commandId = generateCommandId();
    pendingCommandIdRef.current = commandId;
    const action =
      mode === 'create'
        ? TOOL_ADD_TOOL_TABLE_ROW_ACTION
        : TOOL_UPDATE_TOOL_TABLE_ROW_ACTION;
    sendCommand('tool', action, params, commandId);
  }, [
    mode,
    tool,
    toolNumberInput,
    occupiedToolNumbers,
    metaName,
    metaType,
    metaMaterial,
    metaComment,
    metaNumberOfFlutes,
    metaFlutesLength,
    pocket,
    diameter,
    x,
    y,
    z,
    a,
    b,
    c,
    u,
    v,
    w,
    frontAngle,
    backAngle,
    orientation,
    localPresets,
    sendCommand,
  ]);

  const handlePresetSave = useCallback((p: ToolPreset) => {
    setLocalPresets((prev) => {
      const t = presetTarget;
      if (t?.mode === 'edit') {
        const next = [...prev];
        if (t.index >= 0 && t.index < next.length) {
          next[t.index] = p;
        }
        return next;
      }
      return [...prev, p];
    });
    setPresetTarget(null);
  }, [presetTarget]);

  if (mode === 'edit' && !tool) return null;

  const dialogTitle = mode === 'create' ? t('toolEdit.titleCreate') : t('toolEdit.titleEdit');
  const saveLabel = mode === 'create' ? t('toolEdit.saveCreate') : t('toolEdit.saveEdit');
  const parsedCreateToolno =
    mode === 'create' ? parsePositiveToolNumberFromInput(toolNumberInput) : undefined;
  const createToolnoDuplicate =
    parsedCreateToolno != null && occupiedToolNumbers.includes(parsedCreateToolno);

  const parsedEditToolno =
    mode === 'edit' ? parsePositiveToolNumberFromInput(toolNumberInput) : undefined;
  const editToolnoDuplicate =
    parsedEditToolno != null &&
    tool?.toolNumber != null &&
    parsedEditToolno !== tool.toolNumber &&
    occupiedToolNumbers.includes(parsedEditToolno);

  const saveDisabled =
    connectionStatus !== 'connected' ||
    !interpreterIdle ||
    (mode === 'create' &&
      (parsePositiveToolNumberFromInput(toolNumberInput) == null || createToolnoDuplicate)) ||
    (mode === 'edit' &&
      (parsePositiveToolNumberFromInput(toolNumberInput) == null || editToolnoDuplicate));

  const saveDisabledTitle = (() => {
    if (connectionStatus !== 'connected') return t('toolEdit.saveDisabledNoConnection');
    if (!interpreterIdle) {
      return t('toolEdit.saveDisabledInterpBusy');
    }
    if (mode === 'create' && createToolnoDuplicate) return t('toolEdit.saveDisabledDuplicateT');
    if (mode === 'create' && parsePositiveToolNumberFromInput(toolNumberInput) == null) {
      return t('toolEdit.toolNumberRequiredHint');
    }
    if (mode === 'edit' && editToolnoDuplicate) return t('toolEdit.saveDisabledDuplicateT');
    if (mode === 'edit' && parsePositiveToolNumberFromInput(toolNumberInput) == null) {
      return t('toolEdit.toolNumberRequiredHint');
    }
    return undefined;
  })();

  const offsetRows: Array<{
    key: CoordinateAxisKey;
    label: string;
    val: string;
    setVal: (v: string) => void;
  }> = useMemo(() => {
    const all: Array<{
      key: CoordinateAxisKey;
      label: string;
      val: string;
      setVal: (v: string) => void;
    }> = [
      { key: 'x', label: 'X', val: x, setVal: setX },
      { key: 'y', label: 'Y', val: y, setVal: setY },
      { key: 'z', label: 'Z', val: z, setVal: setZ },
      { key: 'a', label: 'A', val: a, setVal: setA },
      { key: 'b', label: 'B', val: b, setVal: setB },
      { key: 'c', label: 'C', val: c, setVal: setC },
      { key: 'u', label: 'U', val: u, setVal: setU },
      { key: 'v', label: 'V', val: v, setVal: setV },
      { key: 'w', label: 'W', val: w, setVal: setW },
    ];
    const set = new Set(activeAxes);
    return all.filter((row) => set.has(row.key));
  }, [activeAxes, x, y, z, a, b, c, u, v, w]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={dialogTitle}
        className="max-w-2xl"
        onEscapeKeyDown={handleToolEditEscapeKeyDown}
      >
        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('toolEdit.sectionIdentification')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                {mode === 'create' ? (
                  <>
                    <TouchNumericPickerField
                      {...touchNumericStackProps}
                      label={t('toolEdit.toolNumberT')}
                      dialogTitle={t('toolEdit.toolNumberT')}
                      value={toolNumberInput}
                      onChange={setToolNumberInput}
                      integerOnly
                      allowEmpty={false}
                      validateParsed={(n) =>
                        n > 0 ? null : t('toolEdit.toolNumberPickerHint')
                      }
                      triggerClassName={
                        createToolnoDuplicate ? 'border-destructive focus:ring-destructive' : undefined
                      }
                      data-e2e="tool-edit-create-toolno"
                    />
                    {createToolnoDuplicate && (
                      <p className="text-xs text-destructive">{t('toolEdit.duplicateTNumber')}</p>
                    )}
                  </>
                ) : (
                  <>
                    <TouchNumericPickerField
                      {...touchNumericStackProps}
                      label={t('toolEdit.toolNumberT')}
                      dialogTitle={t('toolEdit.toolNumberT')}
                      value={toolNumberInput}
                      onChange={setToolNumberInput}
                      integerOnly
                      allowEmpty={false}
                      validateParsed={(n) =>
                        n > 0 ? null : t('toolEdit.toolNumberPickerHint')
                      }
                      triggerClassName={
                        editToolnoDuplicate ? 'border-destructive focus:ring-destructive' : undefined
                      }
                      data-e2e="tool-edit-edit-toolno"
                    />
                    {editToolnoDuplicate && (
                      <p className="text-xs text-destructive">{t('toolEdit.duplicateTNumber')}</p>
                    )}
                  </>
                )}
              </div>
              <TouchNumericPickerField
                {...touchNumericStackProps}
                label={t('toolEdit.pocketP')}
                value={pocket}
                onChange={setPocket}
                allowEmpty
                data-e2e="tool-edit-pocket"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('toolEdit.sectionOffsets')}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {offsetRows.map(({ key, label, val, setVal }) => (
                <TouchNumericPickerField
                  key={key}
                  {...touchNumericStackProps}
                  label={label}
                  value={val}
                  onChange={setVal}
                  allowEmpty
                  data-e2e={`tool-edit-offset-${label}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {showLatheGeometry ? t('toolEdit.sectionGeometryLathe') : t('toolEdit.sectionGeometry')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TouchNumericPickerField
                {...touchNumericStackProps}
                label={t('toolEdit.diameter')}
                value={diameter}
                onChange={setDiameter}
                allowEmpty
                data-e2e="tool-edit-diameter"
              />
              {showLatheGeometry && (
                <>
                  <TouchSelectField
                    label={t('toolEdit.orientation14')}
                    value={orientation}
                    onChange={setOrientation}
                    allowEmpty
                    emptyLabel="–"
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '3', label: '3' },
                      { value: '4', label: '4' },
                    ]}
                    triggerClassName={toolFormTouchSelectTriggerClass}
                  />
                  <TouchNumericPickerField
                    {...touchNumericStackProps}
                    label="Front angle"
                    value={frontAngle}
                    onChange={setFrontAngle}
                    allowEmpty
                    data-e2e="tool-edit-front-angle"
                  />
                  <TouchNumericPickerField
                    {...touchNumericStackProps}
                    label="Back angle"
                    value={backAngle}
                    onChange={setBackAngle}
                    allowEmpty
                    data-e2e="tool-edit-back-angle"
                  />
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('toolEdit.sectionMeta')}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-sm text-muted-foreground">{t('toolEdit.displayName')}</label>
                <input
                  type="text"
                  className={toolFormInputClass}
                  data-e2e="tool-edit-display-name"
                  value={metaName}
                  onChange={(e) => setMetaName(e.target.value)}
                />
              </div>
              <TouchSelectField
                label={t('toolEdit.type')}
                value={metaType}
                onChange={setMetaType}
                allowEmpty
                emptyLabel="–"
                options={ALL_TOOL_TYPES.map((t) => ({ value: t, label: t }))}
                triggerClassName={toolFormTouchSelectTriggerClass}
              />
              <TouchSelectField
                label={t('toolEdit.materialLabel')}
                value={metaMaterial}
                onChange={setMetaMaterial}
                allowEmpty
                emptyLabel={t('toolEdit.materialNotSpecified')}
                data-e2e="tool-edit-material"
                options={TOOL_MATERIAL_VALUES.map((m) => ({
                  value: m,
                  label: t(`material.${TOOL_MATERIAL_I18N_KEY[m]}`),
                }))}
                triggerClassName={toolFormTouchSelectTriggerClass}
              />
              <div className="space-y-1 sm:col-span-2">
                <label className="text-sm text-muted-foreground">{t('toolEdit.displayComment')}</label>
                <input
                  type="text"
                  className={toolFormInputClass}
                  value={metaComment}
                  onChange={(e) => setMetaComment(e.target.value)}
                />
              </div>
              <TouchNumericPickerField
                {...touchNumericStackProps}
                label={t('toolEdit.flutesCount')}
                value={metaNumberOfFlutes}
                onChange={setMetaNumberOfFlutes}
                integerOnly
                allowEmpty
                data-e2e="tool-edit-flutes-count"
              />
              <TouchNumericPickerField
                {...touchNumericStackProps}
                label={t('toolEdit.flutesLengthMm')}
                value={metaFlutesLength}
                onChange={setMetaFlutesLength}
                allowEmpty
                data-e2e="tool-edit-flutes-length"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('toolEdit.sectionPresets')}
            </div>
            {localPresets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('toolEdit.noPresets')}</p>
            ) : (
              <ul className="space-y-2">
                {localPresets.map((pr, i) => (
                  <li
                    key={pr.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                  >
                    <span className="truncate text-sm">{pr.name || pr.id}</span>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPresetTarget({ mode: 'edit', index: i })}
                      >
                        {t('toolEdit.editPreset')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setLocalPresets((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        {t('toolEdit.deletePreset')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPresetTarget({ mode: 'new' })}
            >
              {t('toolEdit.newPreset')}
            </Button>
          </div>
        </div>

        <ToolPresetEditDialog
          open={presetTarget !== null}
          onOpenChange={(next) => {
            if (!next) setPresetTarget(null);
          }}
          preset={presetTarget?.mode === 'edit' ? (localPresets[presetTarget.index] ?? null) : null}
          toolDiameterMm={parseOptionalFloat(diameter)}
          toolNumberOfFlutes={parseOptionalInt(metaNumberOfFlutes)}
          onSave={handlePresetSave}
        />

        <DialogFooter className={cn(touchNumericDialogFooterGridClassName, 'shrink-0')}>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={cn(dialogFooterTouchButtonClass, 'w-full min-w-0')}
            onClick={() => onOpenChange(false)}
          >
            {t('toolEdit.cancel')}
          </Button>
          <AppTooltip
            content={saveDisabled ? saveDisabledTitle : ''}
            disabled={!saveDisabled}
            className="block w-full min-w-0"
          >
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className={cn(
                dialogFooterTouchButtonClass,
                'w-full min-w-0',
                saveDisabled && 'pointer-events-none',
              )}
              onClick={handleSave}
              disabled={saveDisabled}
            >
              {saveLabel}
            </Button>
          </AppTooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
