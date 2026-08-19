import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTouchNumericModalEscapeStack } from '@/hooks/useTouchNumericModalEscapeStack';
import { AppTooltip } from '@/components/AppTooltip';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  mergeTouchSelectTrigger,
  TouchSelectField,
} from '@/components/ui/TouchSelectField';
import { cn } from '@/lib/utils';
import { TouchNumericDialogFooter, TouchNumericPickerField } from '@/components/numeric';
import type { ToolPreset, ToolPresetCoolant } from '@/types/tools';
import {
  feedFromFeedPerTooth,
  feedPerToothFromFeed,
  plungeFeedPerRevFromPlunge,
  plungeFromPlungeFeedPerRev,
  presetGeometryWarnings,
  rpmFromSurfaceSpeed,
  surfaceSpeedFromRpm,
} from '@/lib/toolPresetCalculations';

const inputClass = cn(
  'w-full min-h-11 rounded-md border border-input bg-background/80 px-3 py-2.5 text-base',
  'text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring',
);

const coolantTouchTriggerClass = mergeTouchSelectTrigger(inputClass);

const TOOL_PRESET_COOLANT_VALUES: readonly ToolPresetCoolant[] = [
  'off',
  'flood',
  'mist',
  'through_tool',
  'external_water',
  'air',
];

function parseOptionalFloat(s: string): number | undefined {
  const trimmed = s.trim().replace(',', '.');
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function formatCalc(n: number): string {
  const r = Math.round(n * 1e5) / 1e5;
  return String(r);
}

const DEFAULT_RAMP_ANGLE_DEG = 2;

/** Fraction of cutting feed for helix and plunge feed (often ~1/3). */
const PLUNGE_AND_HELIX_FRACTION_OF_FEED = 1 / 3;

type SatelliteOverrides = {
  leadIn: boolean;
  leadOut: boolean;
  transition: boolean;
  helix: boolean;
  plunge: boolean;
  plungePerRev: boolean;
};

function defaultSatelliteOverrides(): SatelliteOverrides {
  return {
    leadIn: false,
    leadOut: false,
    transition: false,
    helix: false,
    plunge: false,
    plungePerRev: false,
  };
}

/** After load: fields that differ from cutting feed count as manually set. */
function satelliteOverridesFromPreset(p: ToolPreset | null): SatelliteOverrides {
  const o = defaultSatelliteOverrides();
  if (p == null) return o;
  const vf = p.feed_mm_min;
  if (vf == null || !Number.isFinite(vf) || vf < 0) return o;
  const third = vf * PLUNGE_AND_HELIX_FRACTION_OF_FEED;
  const eps = 1e-3;
  if (p.lead_in_feed_mm_min != null && Math.abs(p.lead_in_feed_mm_min - vf) > eps) o.leadIn = true;
  if (p.lead_out_feed_mm_min != null && Math.abs(p.lead_out_feed_mm_min - vf) > eps) o.leadOut = true;
  if (p.transition_feed_mm_min != null && Math.abs(p.transition_feed_mm_min - vf) > eps) o.transition = true;
  if (p.helix_feed_mm_min != null && Math.abs(p.helix_feed_mm_min - third) > eps) o.helix = true;
  if (p.plunge_mm_min != null && Math.abs(p.plunge_mm_min - third) > eps) o.plunge = true;
  const n = p.spindle_rpm;
  if (
    p.plunge_feed_per_rev_mm != null &&
    n != null &&
    n > 0 &&
    p.plunge_mm_min != null &&
    Math.abs(p.plunge_feed_per_rev_mm - p.plunge_mm_min / n) > eps
  ) {
    o.plungePerRev = true;
  }
  return o;
}

type ToolPresetEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = new preset */
  preset: ToolPreset | null;
  toolDiameterMm?: number;
  toolNumberOfFlutes?: number;
  onSave: (preset: ToolPreset) => void;
};

export function ToolPresetEditDialog({
  open,
  onOpenChange,
  preset,
  toolDiameterMm,
  toolNumberOfFlutes,
  onSave,
}: ToolPresetEditDialogProps) {
  const { t } = useTranslation('tools');
  const draftIdRef = useRef<string>('');
  const wasOpenRef = useRef(false);
  const satelliteOverridesRef = useRef<SatelliteOverrides>(defaultSatelliteOverrides());
  /** While true: ramp RPM follows spindle changes until user edits ramp RPM. */
  const rampFollowsSpindleRef = useRef(true);

  const { onOuterEscapeKeyDown: handlePresetEscapeKeyDown, touchNumericStackProps } =
    useTouchNumericModalEscapeStack({ outerOpen: open });

  const FxHint = () => (
    <AppTooltip content={t('presetDialog.fxTooltip')}>
      <span className="inline-flex min-w-[1.25rem] justify-center text-[10px] font-medium uppercase tracking-tight text-muted-foreground">
        fx
      </span>
    </AppTooltip>
  );

  const coolantOptions = useMemo(
    () =>
      TOOL_PRESET_COOLANT_VALUES.map((value) => ({
        value,
        label: t(`coolant.${value}`),
      })),
    [t],
  );

  const [name, setName] = useState('');
  const [spindleRpm, setSpindleRpm] = useState('');
  const [surfaceSpeed, setSurfaceSpeed] = useState('');
  const [rampSpindleRpm, setRampSpindleRpm] = useState('');
  const [feedMmMin, setFeedMmMin] = useState('');
  const [feedPerTooth, setFeedPerTooth] = useState('');
  const [leadIn, setLeadIn] = useState('');
  const [leadOut, setLeadOut] = useState('');
  const [transition, setTransition] = useState('');
  const [helix, setHelix] = useState('');
  const [rampAngle, setRampAngle] = useState('');
  const [plunge, setPlunge] = useState('');
  const [plungePerRev, setPlungePerRev] = useState('');
  const [useStepdown, setUseStepdown] = useState(false);
  const [useStepover, setUseStepover] = useState(false);
  const [maxStepdown, setMaxStepdown] = useState('');
  const [maxStepover, setMaxStepover] = useState('');
  const [coolant, setCoolant] = useState<ToolPresetCoolant>('off');
  const [comment, setComment] = useState('');

  const hydrate = useCallback(
    (p: ToolPreset | null) => {
      draftIdRef.current = p?.id?.trim() || crypto.randomUUID();
      setName(p?.name ?? '');
      setSpindleRpm(p?.spindle_rpm != null ? String(p.spindle_rpm) : '');
      setSurfaceSpeed(p?.surface_speed_m_per_min != null ? String(p.surface_speed_m_per_min) : '');
      if (p?.ramp_spindle_rpm != null) {
        rampFollowsSpindleRef.current = false;
        setRampSpindleRpm(String(p.ramp_spindle_rpm));
      } else {
        rampFollowsSpindleRef.current = true;
        setRampSpindleRpm(p?.spindle_rpm != null ? String(p.spindle_rpm) : '');
      }
      setFeedMmMin(p?.feed_mm_min != null ? String(p.feed_mm_min) : '');
      setFeedPerTooth(p?.feed_per_tooth_mm != null ? String(p.feed_per_tooth_mm) : '');
      setLeadIn(p?.lead_in_feed_mm_min != null ? String(p.lead_in_feed_mm_min) : '');
      setLeadOut(p?.lead_out_feed_mm_min != null ? String(p.lead_out_feed_mm_min) : '');
      setTransition(p?.transition_feed_mm_min != null ? String(p.transition_feed_mm_min) : '');
      setHelix(p?.helix_feed_mm_min != null ? String(p.helix_feed_mm_min) : '');
      setRampAngle(p?.ramp_angle_deg != null ? String(p.ramp_angle_deg) : String(DEFAULT_RAMP_ANGLE_DEG));
      setPlunge(p?.plunge_mm_min != null ? String(p.plunge_mm_min) : '');
      setPlungePerRev(p?.plunge_feed_per_rev_mm != null ? String(p.plunge_feed_per_rev_mm) : '');
      setUseStepdown(Boolean(p?.use_stepdown));
      setUseStepover(Boolean(p?.use_stepover));
      setMaxStepdown(p?.max_stepdown_mm != null ? String(p.max_stepdown_mm) : '');
      setMaxStepover(p?.max_stepover_mm != null ? String(p.max_stepover_mm) : '');
      const c = p?.coolant;
      const valid = typeof c === 'string' && TOOL_PRESET_COOLANT_VALUES.includes(c as ToolPresetCoolant);
      setCoolant((valid ? (c as ToolPresetCoolant) : 'off') as ToolPresetCoolant);
      setComment(p?.comment ?? '');
      satelliteOverridesRef.current = satelliteOverridesFromPreset(p);
    },
    [],
  );

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      hydrate(preset);
    }
    wasOpenRef.current = open;
    if (!open) {
      wasOpenRef.current = false;
    }
  }, [open, preset, hydrate]);

  const D = toolDiameterMm;
  const z = toolNumberOfFlutes;
  const geoWarnings = presetGeometryWarnings({ diameterMm: D, numberOfFlutes: z });

  const syncSatelliteFeedsFromCutting = (vf: number) => {
    if (!Number.isFinite(vf) || vf < 0) return;
    const o = satelliteOverridesRef.current;
    const n = parseOptionalFloat(spindleRpm);
    const fStr = formatCalc(vf);
    if (!o.leadIn) setLeadIn(fStr);
    if (!o.leadOut) setLeadOut(fStr);
    if (!o.transition) setTransition(fStr);
    const third = vf * PLUNGE_AND_HELIX_FRACTION_OF_FEED;
    const thirdStr = formatCalc(third);
    if (!o.helix) setHelix(thirdStr);
    if (!o.plunge) {
      setPlunge(thirdStr);
      if (!o.plungePerRev) {
        const ppr = plungeFeedPerRevFromPlunge(third, n);
        if (ppr !== undefined) setPlungePerRev(formatCalc(ppr));
      }
    }
  };

  const onSpindleRpmChange = (v: string) => {
    setSpindleRpm(v);
    const n = parseOptionalFloat(v);
    if (n === undefined || n <= 0) {
      if (rampFollowsSpindleRef.current) setRampSpindleRpm('');
      return;
    }
    const vc = surfaceSpeedFromRpm(D, n);
    if (vc !== undefined) setSurfaceSpeed(formatCalc(vc));
    if (rampFollowsSpindleRef.current) setRampSpindleRpm(v);
  };

  const onSurfaceSpeedChange = (v: string) => {
    setSurfaceSpeed(v);
    const vc = parseOptionalFloat(v);
    if (vc === undefined || vc <= 0) return;
    const n = rpmFromSurfaceSpeed(D, vc);
    if (n !== undefined) {
      const nStr = formatCalc(n);
      setSpindleRpm(nStr);
      if (rampFollowsSpindleRef.current) setRampSpindleRpm(nStr);
    }
  };

  const onRampSpindleRpmChange = (v: string) => {
    rampFollowsSpindleRef.current = false;
    setRampSpindleRpm(v);
  };

  const onFeedChange = (v: string) => {
    setFeedMmMin(v);
    const vf = parseOptionalFloat(v);
    const n = parseOptionalFloat(spindleRpm);
    if (vf !== undefined && vf >= 0) {
      const fz = feedPerToothFromFeed(vf, n, z);
      if (fz !== undefined) setFeedPerTooth(formatCalc(fz));
      syncSatelliteFeedsFromCutting(vf);
    }
  };

  const onFeedPerToothChange = (v: string) => {
    setFeedPerTooth(v);
    const fz = parseOptionalFloat(v);
    const n = parseOptionalFloat(spindleRpm);
    if (fz === undefined || fz < 0) return;
    const vf = feedFromFeedPerTooth(fz, n, z);
    if (vf !== undefined) {
      setFeedMmMin(formatCalc(vf));
      syncSatelliteFeedsFromCutting(vf);
    }
  };

  const onPlungeChange = (v: string) => {
    satelliteOverridesRef.current.plunge = true;
    setPlunge(v);
    const pv = parseOptionalFloat(v);
    const n = parseOptionalFloat(spindleRpm);
    if (pv === undefined || pv < 0) return;
    const ppr = plungeFeedPerRevFromPlunge(pv, n);
    if (ppr !== undefined) setPlungePerRev(formatCalc(ppr));
  };

  const onPlungePerRevChange = (v: string) => {
    satelliteOverridesRef.current.plungePerRev = true;
    setPlungePerRev(v);
    const ppr = parseOptionalFloat(v);
    const n = parseOptionalFloat(spindleRpm);
    if (ppr === undefined || ppr < 0) return;
    const pv = plungeFromPlungeFeedPerRev(ppr, n);
    if (pv !== undefined) setPlunge(formatCalc(pv));
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const out: ToolPreset = {
      id: draftIdRef.current,
      name: trimmedName,
      coolant,
    };

    const addNum = (key: keyof ToolPreset, s: string) => {
      const v = parseOptionalFloat(s);
      if (v !== undefined && v >= 0) {
        (out as Record<string, number>)[key as string] = v;
      }
    };

    addNum('spindle_rpm', spindleRpm);
    addNum('surface_speed_m_per_min', surfaceSpeed);
    addNum('ramp_spindle_rpm', rampSpindleRpm);
    addNum('feed_mm_min', feedMmMin);
    addNum('feed_per_tooth_mm', feedPerTooth);
    addNum('lead_in_feed_mm_min', leadIn);
    addNum('lead_out_feed_mm_min', leadOut);
    addNum('transition_feed_mm_min', transition);
    addNum('helix_feed_mm_min', helix);
    addNum('ramp_angle_deg', rampAngle);
    addNum('plunge_mm_min', plunge);
    addNum('plunge_feed_per_rev_mm', plungePerRev);
    if (useStepdown) addNum('max_stepdown_mm', maxStepdown);
    if (useStepover) addNum('max_stepover_mm', maxStepover);

    if (useStepdown) out.use_stepdown = true;
    if (useStepover) out.use_stepover = true;

    if (comment.trim()) out.comment = comment.trim().slice(0, 500);

    if (coolant === 'off') {
      delete (out as { coolant?: string }).coolant;
    }

    onSave(out);
  };

  const saveDisabled = !name.trim();

  const fieldRow = (
    label: string,
    unit: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { formulaDerived?: boolean; labelTooltip?: ReactNode },
  ) => (
    <TouchNumericPickerField
      label={label}
      unit={unit}
      value={value}
      onChange={onChange}
      allowEmpty
      {...touchNumericStackProps}
      labelAccessory={opts?.formulaDerived ? <FxHint /> : undefined}
      labelTooltip={opts?.labelTooltip}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={preset ? t('presetDialog.editTitle') : t('presetDialog.newTitle')}
        className={cn(
          'flex max-h-[90vh] min-h-0 w-[min(96vw,72rem)] max-w-none flex-col overflow-hidden sm:max-w-none',
        )}
        onEscapeKeyDown={handlePresetEscapeKeyDown}
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden pr-2">
          {geoWarnings.length > 0 && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              role="status"
            >
              <div className="font-medium text-amber-100">{t('presetDialog.geoWarningTitle')}</div>
              <ul className="mt-1 list-inside list-disc text-xs leading-relaxed opacity-95">
                {geoWarnings.map((w) => (
                  <li key={w}>{t(`presetWarnings.${w}`)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetDialog.sectionGeneral')}
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">{t('presetDialog.name')}</label>
              <input
                type="text"
                className={inputClass}
                data-e2e="tool-preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('presetDialog.namePlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetDialog.sectionSpeed')}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {fieldRow(t('presetDialog.spindleRpm'), t('presetDialog.unitRpm'), spindleRpm, onSpindleRpmChange, {
                formulaDerived: true,
                labelTooltip: t('presetHelp.spindleRpm'),
              })}
              {fieldRow(
                t('presetDialog.surfaceSpeed'),
                t('presetDialog.unitMPerMin'),
                surfaceSpeed,
                onSurfaceSpeedChange,
                {
                  formulaDerived: true,
                  labelTooltip: t('presetHelp.surfaceSpeed'),
                },
              )}
              {fieldRow(
                t('presetDialog.rampSpindleRpm'),
                t('presetDialog.unitRpm'),
                rampSpindleRpm,
                onRampSpindleRpmChange,
                {
                  labelTooltip: t('presetHelp.rampSpindleRpm'),
                },
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetDialog.sectionFeed')}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {fieldRow(t('presetDialog.feedMmMin'), t('presetDialog.unitMmMin'), feedMmMin, onFeedChange, {
                formulaDerived: true,
                labelTooltip: t('presetHelp.feedMmMin'),
              })}
              {fieldRow(
                t('presetDialog.feedPerTooth'),
                t('presetDialog.unitMm'),
                feedPerTooth,
                onFeedPerToothChange,
                {
                  formulaDerived: true,
                  labelTooltip: t('presetHelp.feedPerTooth'),
                },
              )}
              {fieldRow(t('presetDialog.rampAngle'), t('presetDialog.unitDeg'), rampAngle, setRampAngle, {
                labelTooltip: t('presetHelp.rampAngle'),
              })}
              {fieldRow(t('presetDialog.leadIn'), t('presetDialog.unitMmMin'), leadIn, (v) => {
                satelliteOverridesRef.current.leadIn = true;
                setLeadIn(v);
              }, { labelTooltip: t('presetHelp.leadIn') })}
              {fieldRow(t('presetDialog.leadOut'), t('presetDialog.unitMmMin'), leadOut, (v) => {
                satelliteOverridesRef.current.leadOut = true;
                setLeadOut(v);
              }, { labelTooltip: t('presetHelp.leadOut') })}
              {fieldRow(t('presetDialog.transition'), t('presetDialog.unitMmMin'), transition, (v) => {
                satelliteOverridesRef.current.transition = true;
                setTransition(v);
              }, { labelTooltip: t('presetHelp.transition') })}
              {fieldRow(t('presetDialog.helix'), t('presetDialog.unitMmMin'), helix, (v) => {
                satelliteOverridesRef.current.helix = true;
                setHelix(v);
              }, { labelTooltip: t('presetHelp.helix') })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetDialog.sectionPlunge')}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {fieldRow(t('presetDialog.plunge'), t('presetDialog.unitMmMin'), plunge, onPlungeChange, {
                formulaDerived: true,
                labelTooltip: t('presetHelp.plunge'),
              })}
              {fieldRow(
                t('presetDialog.plungePerRev'),
                t('presetDialog.unitMm'),
                plungePerRev,
                onPlungePerRevChange,
                { formulaDerived: true, labelTooltip: t('presetHelp.plungePerRev') },
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetDialog.sectionPasses')}
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={useStepdown}
                  onChange={(e) => setUseStepdown(e.target.checked)}
                />
                {t('presetDialog.useStepdown')}
              </label>
              {useStepdown && (
                <div className="sm:max-w-xs">
                  {fieldRow(t('presetDialog.maxStepdown'), t('presetDialog.unitMm'), maxStepdown, setMaxStepdown, {
                    labelTooltip: t('presetHelp.maxStepdown'),
                  })}
                </div>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={useStepover}
                  onChange={(e) => setUseStepover(e.target.checked)}
                />
                {t('presetDialog.useStepover')}
              </label>
              {useStepover && (
                <div className="sm:max-w-xs">
                  {fieldRow(t('presetDialog.maxStepover'), t('presetDialog.unitMm'), maxStepover, setMaxStepover, {
                    labelTooltip: t('presetHelp.maxStepover'),
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetDialog.sectionCoolant')}
            </div>
            <TouchSelectField
              hideLabel
              label={t('presetDialog.coolant')}
              value={coolant}
              onChange={(v) => setCoolant(v as ToolPresetCoolant)}
              options={coolantOptions}
              triggerClassName={coolantTouchTriggerClass}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t('presetDialog.comment')}</label>
            <input
              type="text"
              className={inputClass}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </div>

        <TouchNumericDialogFooter
          className="shrink-0"
          onCancel={() => onOpenChange(false)}
          onConfirm={handleSave}
          cancelLabel={t('presetDialog.cancel')}
          confirmLabel={t('presetDialog.apply')}
          confirmDisabled={saveDisabled}
        />
      </DialogContent>
    </Dialog>
  );
}
