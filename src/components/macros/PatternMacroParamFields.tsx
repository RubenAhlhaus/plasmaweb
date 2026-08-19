import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { MacroDefinition, MacroParams } from '@/types/macros';
import { TouchNumericPickerField } from '@/components/numeric';
import { Button } from '@/components/ui/button';
import { PatternPreviewSvg } from '@/components/macros/PatternPreviewSvg';
import { cn } from '@/lib/utils';
import {
  buildPatternPreviewParams,
  patternNumericParam,
  tryExpandPatternPositions,
  type PatternLiveNumericDraft,
} from '@/lib/macroGcode/expandPatternPositions';
import {
  newCustomPatternRowId,
  parseCustomPatternRowsForUi,
  serializeCustomPatternRows,
  type CustomPatternRowEditable,
} from '@/lib/customPatternPoints';
import { strParam } from '@/lib/macroParams';

const noopPatternDraftChange = (): void => undefined;

type PatternMacroParamFieldsProps = {
  definition: MacroDefinition;
  params: MacroParams;
  setParams: Dispatch<SetStateAction<MacroParams>>;
  setCommitError: (msg: string | null) => void;
  touchNumericStackProps?: { onDialogOpenChange?: (open: boolean) => void };
};

type PatternTabId = 'custom' | 'round' | 'rectangular';

/** Numeric pattern fields that can feed `patternLiveDraft` (stable handler map). */
const PATTERN_MACRO_LIVE_FIELD_KEYS = [
  'surfaceZ',
  'centerX',
  'centerY',
  'count',
  'pitchCircleDiameter',
  'startAngle',
  'startX',
  'startY',
  'columns',
  'rows',
  'spacingX',
  'spacingY',
] as const;

export function PatternMacroParamFields({
  definition,
  params,
  setParams,
  setCommitError,
  touchNumericStackProps,
}: PatternMacroParamFieldsProps) {
  const { t } = useTranslation('macros');
  const patternTabs = useMemo(
    () =>
      (
        [
          ['custom', 'patternUi.tabs.custom'],
          ['round', 'patternUi.tabs.round'],
          ['rectangular', 'patternUi.tabs.rectangular'],
        ] as const
      ).map(([id, labelKey]) => ({
        id: id as PatternTabId,
        label: t(labelKey),
      })),
    [t],
  );
  const [centerXDialogOpen, setCenterXDialogOpen] = useState(false);
  const [centerYDialogOpen, setCenterYDialogOpen] = useState(false);
  const [centerXTriggerFocus, setCenterXTriggerFocus] = useState(false);
  const [centerYTriggerFocus, setCenterYTriggerFocus] = useState(false);
  const [startXDialogOpen, setStartXDialogOpen] = useState(false);
  const [startYDialogOpen, setStartYDialogOpen] = useState(false);
  const [startXTriggerFocus, setStartXTriggerFocus] = useState(false);
  const [startYTriggerFocus, setStartYTriggerFocus] = useState(false);
  const [centerFieldHoverX, setCenterFieldHoverX] = useState(false);
  const [centerFieldHoverY, setCenterFieldHoverY] = useState(false);
  const [startFieldHoverX, setStartFieldHoverX] = useState(false);
  const [startFieldHoverY, setStartFieldHoverY] = useState(false);
  const [patternLiveDraft, setPatternLiveDraft] = useState<PatternLiveNumericDraft | null>(null);

  const patternType = (strParam(params, 'patternType') as PatternTabId) || 'custom';
  const customRows = useMemo(
    () => parseCustomPatternRowsForUi(strParam(params, 'customPatternPoints')),
    [params.customPatternPoints],
  );

  const setPatternType = (id: PatternTabId) => {
    setCommitError(null);
    setParams((prev) => ({ ...prev, patternType: id }));
  };

  const updateCustomRows = (next: CustomPatternRowEditable[]) => {
    setCommitError(null);
    setParams((prev) => ({ ...prev, customPatternPoints: serializeCustomPatternRows(next) }));
  };

  const previewParams = useMemo(
    () => buildPatternPreviewParams(params, patternLiveDraft),
    [params, patternLiveDraft],
  );
  const previewPoints = useMemo(() => tryExpandPatternPositions(previewParams) ?? [], [previewParams]);

  const stackPickerOpenChange = touchNumericStackProps?.onDialogOpenChange;

  const macroLiveDraftByField = useMemo(() => {
    const out = {} as Record<(typeof PATTERN_MACRO_LIVE_FIELD_KEYS)[number], (draft: string | null) => void>;
    for (const field of PATTERN_MACRO_LIVE_FIELD_KEYS) {
      out[field] = (draft: string | null) =>
        setPatternLiveDraft(draft === null ? null : { kind: 'macro', field, draft });
    }
    return out;
  }, []);

  const customLiveDraftHandlers = useMemo(() => {
    const m = new Map<string, (draft: string | null) => void>();
    for (const row of customRows) {
      const { id } = row;
      m.set(`${id}:x`, (draft: string | null) =>
        setPatternLiveDraft(draft === null ? null : { kind: 'custom', rowId: id, axis: 'x', draft }),
      );
      m.set(`${id}:y`, (draft: string | null) =>
        setPatternLiveDraft(draft === null ? null : { kind: 'custom', rowId: id, axis: 'y', draft }),
      );
    }
    return m;
  }, [customRows]);

  const wrapCenterPickerOpen =
    (which: 'x' | 'y') =>
    (open: boolean) => {
      stackPickerOpenChange?.(open);
      if (which === 'x') setCenterXDialogOpen(open);
      else setCenterYDialogOpen(open);
    };

  const wrapStartPickerOpen =
    (which: 'sx' | 'sy') =>
    (open: boolean) => {
      stackPickerOpenChange?.(open);
      if (which === 'sx') setStartXDialogOpen(open);
      else setStartYDialogOpen(open);
    };

  const centerMarkerEmphasized =
    patternType === 'round' &&
    (centerXDialogOpen ||
      centerYDialogOpen ||
      centerXTriggerFocus ||
      centerYTriggerFocus ||
      centerFieldHoverX ||
      centerFieldHoverY);

  const roundCenterMm =
    patternType === 'round'
      ? {
          x: patternNumericParam(previewParams, 'centerX'),
          y: patternNumericParam(previewParams, 'centerY'),
        }
      : null;

  const rectOriginMarkerEmphasized =
    patternType === 'rectangular' &&
    (startXDialogOpen ||
      startYDialogOpen ||
      startXTriggerFocus ||
      startYTriggerFocus ||
      startFieldHoverX ||
      startFieldHoverY);

  const rectGridOriginMm =
    patternType === 'rectangular'
      ? {
          x: patternNumericParam(previewParams, 'startX'),
          y: patternNumericParam(previewParams, 'startY'),
        }
      : null;

  useEffect(() => {
    setPatternLiveDraft(null);
  }, [patternType]);

  useEffect(() => {
    if (patternType !== 'round') {
      setCenterXDialogOpen(false);
      setCenterYDialogOpen(false);
      setCenterXTriggerFocus(false);
      setCenterYTriggerFocus(false);
      setCenterFieldHoverX(false);
      setCenterFieldHoverY(false);
    }
    if (patternType !== 'rectangular') {
      setStartXDialogOpen(false);
      setStartYDialogOpen(false);
      setStartXTriggerFocus(false);
      setStartYTriggerFocus(false);
      setStartFieldHoverX(false);
      setStartFieldHoverY(false);
    }
  }, [patternType]);

  const patternDialogAside = useMemo(
    () => (
      <PatternPreviewSvg
        points={previewPoints}
        className="aspect-square h-auto w-full max-h-[min(20rem,36vh)]"
        ariaLabel={t('patternUi.previewAria')}
        roundCenterMm={roundCenterMm}
        centerMarkerEmphasized={centerMarkerEmphasized}
        rectGridOriginMm={rectGridOriginMm}
        rectOriginMarkerEmphasized={rectOriginMarkerEmphasized}
      />
    ),
    [
      previewPoints,
      roundCenterMm,
      centerMarkerEmphasized,
      rectGridOriginMm,
      rectOriginMarkerEmphasized,
      t,
    ],
  );

  return (
    <div
      className={cn(
        'grid gap-6',
        'grid-cols-1 lg:[grid-template-columns:minmax(0,24rem)_minmax(0,1fr)]',
      )}
    >
      <aside
        className="mx-auto w-full rounded-md border border-border/60 bg-muted/20 p-2 lg:mx-0"
        style={{ maxWidth: '24rem' }}
      >
        <PatternPreviewSvg
          points={previewPoints}
          className="aspect-square h-auto w-full max-h-[min(24rem,45vh)]"
          ariaLabel={t('patternUi.previewAria')}
          roundCenterMm={roundCenterMm}
          centerMarkerEmphasized={centerMarkerEmphasized}
          rectGridOriginMm={rectGridOriginMm}
          rectOriginMarkerEmphasized={rectOriginMarkerEmphasized}
        />
      </aside>

      <div className="min-w-0 space-y-6">
        <div className="space-y-3">
          <div className="space-y-1 min-w-0 w-full">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              {t('patternLabels.name')}
            </label>
            <input
              type="text"
              value={strParam(params, 'name')}
              onChange={(e) => {
                setCommitError(null);
                setParams((prev) => ({ ...prev, name: e.target.value }));
              }}
              className={cn(
                'w-full h-14 rounded-md border border-input bg-background/80 px-3',
                'text-foreground placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            />
          </div>
          <TouchNumericPickerField
            {...(touchNumericStackProps ?? {})}
            dialogAside={patternDialogAside}
            onDialogDraftChange={macroLiveDraftByField.surfaceZ}
            value={String(params.surfaceZ ?? '')}
            onChange={(v) => {
              setCommitError(null);
              setParams((prev) => ({ ...prev, surfaceZ: v }));
            }}
            label={t('patternLabels.surfaceZ')}
            dialogTitle={t('patternLabels.surfaceZ')}
            triggerClassName="h-14 min-h-14 py-0"
            className="min-w-0 w-full"
          />
        </div>

        <div
          role="tablist"
          aria-label={t('patternUi.arrangementAria')}
          className="flex w-full overflow-hidden rounded-lg border border-border/80 bg-muted/40 shadow-sm"
        >
          {patternTabs.map((tab, tabIdx) => {
            const active = patternType === tab.id;
            return (
              <Button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                variant={active ? 'default' : 'ghost'}
                className={cn(
                  'touch-manipulation min-h-14 flex-1 basis-0 rounded-none border-0 px-2 text-sm font-medium leading-tight sm:px-3 sm:text-base',
                  'shadow-none',
                  tabIdx > 0 && 'border-l border-border/70',
                  !active && 'text-foreground hover:bg-background/65',
                )}
                onClick={() => setPatternType(tab.id)}
              >
                {tab.label}
              </Button>
            );
          })}
        </div>

        {patternType === 'custom' ? (
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 w-full max-w-full rounded-md border border-border/60 overflow-hidden">
              <table className="table-fixed w-full border-collapse text-sm">
                <colgroup>
                  <col className="min-w-0" />
                  <col className="min-w-0" />
                  <col className="w-20 shrink-0" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="border-r border-border/60 text-left font-medium px-2 py-2.5 pl-3">
                      {t('patternValidation.coordX')}
                    </th>
                    <th className="border-r border-border/60 text-left font-medium px-2 py-2.5">
                      {t('patternValidation.coordY')}
                    </th>
                    <th className="w-20 shrink-0 p-0" scope="col">
                      <span className="sr-only">{t('patternUi.deleteRow')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customRows.map((row) => (
                    <tr key={row.id} className="border-b border-border/40 last:border-0">
                      <td className="border-r border-border/50 px-2 py-1.5 pl-3 align-middle min-w-0">
                        <TouchNumericPickerField
                          {...(touchNumericStackProps ?? {})}
                          dialogAside={patternDialogAside}
                          onDialogDraftChange={
                            customLiveDraftHandlers.get(`${row.id}:x`) ?? noopPatternDraftChange
                          }
                          hideLabel
                          value={row.x}
                          onChange={(v) => {
                            updateCustomRows(
                              customRows.map((r) => (r.id === row.id ? { ...r, x: v } : r)),
                            );
                          }}
                          label={t('patternValidation.coordX')}
                          dialogTitle={t('patternValidation.coordX')}
                          triggerClassName="h-12 min-h-12 py-0 px-3"
                          className="min-w-0 w-full"
                        />
                      </td>
                      <td className="border-r border-border/50 px-2 py-1.5 align-middle min-w-0">
                        <TouchNumericPickerField
                          {...(touchNumericStackProps ?? {})}
                          dialogAside={patternDialogAside}
                          onDialogDraftChange={
                            customLiveDraftHandlers.get(`${row.id}:y`) ?? noopPatternDraftChange
                          }
                          hideLabel
                          value={row.y}
                          onChange={(v) => {
                            updateCustomRows(
                              customRows.map((r) => (r.id === row.id ? { ...r, y: v } : r)),
                            );
                          }}
                          label={t('patternValidation.coordY')}
                          dialogTitle={t('patternValidation.coordY')}
                          triggerClassName="h-12 min-h-12 py-0 px-3"
                          className="min-w-0 w-full"
                        />
                      </td>
                      <td className="box-border w-20 shrink-0 px-1.5 py-1 align-middle">
                        <div className="flex h-full min-h-[4rem] items-center justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              'flex h-16 w-16 shrink-0 rounded-lg p-0 touch-manipulation',
                              'border-destructive/45 bg-background text-destructive',
                              'transition-[background-color,border-color,box-shadow,transform] duration-150',
                              'hover:border-destructive hover:bg-destructive/20 hover:text-destructive hover:shadow-md',
                              'active:scale-[0.96] active:bg-destructive/30',
                              'disabled:pointer-events-none disabled:border-border disabled:bg-muted/30 disabled:text-muted-foreground disabled:opacity-70',
                              'disabled:shadow-none disabled:hover:shadow-none',
                            )}
                            aria-label={t('patternUi.deleteRow')}
                            disabled={customRows.length <= 1}
                            onClick={() => {
                              if (customRows.length <= 1) return;
                              updateCustomRows(customRows.filter((r) => r.id !== row.id));
                            }}
                          >
                            <Trash2 className="mx-auto h-7 w-7 shrink-0" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full min-h-12 touch-manipulation gap-2"
              onClick={() =>
                updateCustomRows([...customRows, { id: newCustomPatternRowId(), x: '', y: '' }])
              }
            >
              <Plus className="h-5 w-5" />
              {t('patternUi.addPosition')}
            </Button>
          </div>
        ) : null}

        {patternType === 'round' ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            {(
              [
                ['centerX', 'x'],
                ['centerY', 'y'],
                ['count', null],
                ['pitchCircleDiameter', null],
                ['startAngle', null],
              ] as const
            ).map(([key, centerKind]) => {
              const label = t(`patternLabels.${key}`);
              const labelTooltip =
                key === 'startAngle' ? t('patternUi.startAngleHint') : undefined;
              const field = (
                <TouchNumericPickerField
                  {...(touchNumericStackProps ?? {})}
                  dialogAside={patternDialogAside}
                  onDialogDraftChange={macroLiveDraftByField[key]}
                  onDialogOpenChange={
                    centerKind === 'x'
                      ? wrapCenterPickerOpen('x')
                      : centerKind === 'y'
                        ? wrapCenterPickerOpen('y')
                        : stackPickerOpenChange
                  }
                  onTriggerFocusChange={
                    centerKind === 'x'
                      ? setCenterXTriggerFocus
                      : centerKind === 'y'
                        ? setCenterYTriggerFocus
                        : undefined
                  }
                  value={String(params[key] ?? definition.defaultParams[key] ?? '')}
                  onChange={(v) => {
                    setCommitError(null);
                    setParams((prev) => ({ ...prev, [key]: v }));
                  }}
                  label={label}
                  dialogTitle={label}
                  labelTooltip={labelTooltip}
                  triggerClassName="h-14 min-h-14 py-0"
                  className="min-w-0 w-full"
                />
              );
              if (centerKind === 'x') {
                return (
                  <div
                    key={key}
                    className="min-w-0 w-full"
                    onMouseEnter={() => setCenterFieldHoverX(true)}
                    onMouseLeave={() => setCenterFieldHoverX(false)}
                  >
                    {field}
                  </div>
                );
              }
              if (centerKind === 'y') {
                return (
                  <div
                    key={key}
                    className="min-w-0 w-full"
                    onMouseEnter={() => setCenterFieldHoverY(true)}
                    onMouseLeave={() => setCenterFieldHoverY(false)}
                  >
                    {field}
                  </div>
                );
              }
              return (
                <div key={key} className="min-w-0 w-full">
                  {field}
                </div>
              );
            })}
          </div>
        ) : null}

        {patternType === 'rectangular' ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            {(
              [
                ['startX', 'sx'],
                ['startY', 'sy'],
                ['columns', null],
                ['rows', null],
                ['spacingX', null],
                ['spacingY', null],
              ] as const
            ).map(([key, startKind]) => {
              const label = t(`patternLabels.${key}`);
              const field = (
                <TouchNumericPickerField
                  {...(touchNumericStackProps ?? {})}
                  dialogAside={patternDialogAside}
                  onDialogDraftChange={macroLiveDraftByField[key]}
                  onDialogOpenChange={
                    startKind === 'sx'
                      ? wrapStartPickerOpen('sx')
                      : startKind === 'sy'
                        ? wrapStartPickerOpen('sy')
                        : stackPickerOpenChange
                  }
                  onTriggerFocusChange={
                    startKind === 'sx'
                      ? setStartXTriggerFocus
                      : startKind === 'sy'
                        ? setStartYTriggerFocus
                        : undefined
                  }
                  value={String(params[key] ?? definition.defaultParams[key] ?? '')}
                  onChange={(v) => {
                    setCommitError(null);
                    setParams((prev) => ({ ...prev, [key]: v }));
                  }}
                  label={label}
                  dialogTitle={label}
                  triggerClassName="h-14 min-h-14 py-0"
                  className="min-w-0 w-full"
                />
              );
              if (startKind === 'sx') {
                return (
                  <div
                    key={key}
                    className="min-w-0 w-full"
                    onMouseEnter={() => setStartFieldHoverX(true)}
                    onMouseLeave={() => setStartFieldHoverX(false)}
                  >
                    {field}
                  </div>
                );
              }
              if (startKind === 'sy') {
                return (
                  <div
                    key={key}
                    className="min-w-0 w-full"
                    onMouseEnter={() => setStartFieldHoverY(true)}
                    onMouseLeave={() => setStartFieldHoverY(false)}
                  >
                    {field}
                  </div>
                );
              }
              return (
                <TouchNumericPickerField
                  key={key}
                  {...(touchNumericStackProps ?? {})}
                  dialogAside={patternDialogAside}
                  onDialogDraftChange={macroLiveDraftByField[key]}
                  onDialogOpenChange={stackPickerOpenChange}
                  value={String(params[key] ?? definition.defaultParams[key] ?? '')}
                  onChange={(v) => {
                    setCommitError(null);
                    setParams((prev) => ({ ...prev, [key]: v }));
                  }}
                  label={label}
                  dialogTitle={label}
                  triggerClassName="h-14 min-h-14 py-0"
                  className="min-w-0 w-full"
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
