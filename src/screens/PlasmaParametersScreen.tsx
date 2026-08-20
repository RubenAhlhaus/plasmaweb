import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TouchNumericPickerField } from '@/components/numeric';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { useAppStore } from '@/store';

/**
 * The `[PLASMA_PARAMETERS]` keys, grouped the way QtPlasmaC's PARAMETERS tab groups them.
 *
 * Keys are QtPlasmaC's own spelling because that is the contract with the prefs file — the
 * backend writes and reads exactly these strings, and inventing UI names for them would mean
 * two names for one setting. `integer` marks the four the file stores without a decimal
 * point; QtPlasmaC reads those with `getint` and resets a value it cannot parse.
 */
const PARAMETER_GROUPS = [
  {
    titleKey: 'arc',
    keys: [
      { key: 'Arc Fail Timeout', unit: 's' },
      { key: 'Arc Maximum Starts', unit: '', integer: true },
      { key: 'Arc Restart Delay', unit: 's' },
      { key: 'Arc OK High', unit: 'V' },
      { key: 'Arc OK Low', unit: 'V' },
      { key: 'Arc Voltage Scale', unit: '' },
      { key: 'Arc Voltage Offset', unit: '' },
    ],
  },
  {
    titleKey: 'thc',
    keys: [
      { key: 'Pid P Gain', unit: '' },
      { key: 'Pid I Gain', unit: '' },
      { key: 'Pid D Gain', unit: '' },
      { key: 'THC Delay', unit: 's' },
      { key: 'THC Threshold', unit: 'V' },
      { key: 'THC Sample Counts', unit: '', integer: true },
      { key: 'THC Sample Threshold', unit: 'V' },
      { key: 'Height Per Volt', unit: 'mm' },
      { key: 'Velocity Anti Dive Threshold', unit: '%' },
      { key: 'Void Sense Slope', unit: '', integer: true },
    ],
  },
  {
    titleKey: 'probe',
    keys: [
      { key: 'Probe Feed Rate', unit: 'mm/min' },
      { key: 'Probe Start Height', unit: 'mm' },
      { key: 'Float Switch Travel', unit: 'mm' },
      { key: 'Skip IHS Distance', unit: 'mm' },
      { key: 'Ohmic Probe Offset', unit: 'mm' },
      { key: 'Ohmic Maximum Attempts', unit: '', integer: true },
    ],
  },
  {
    titleKey: 'motion',
    keys: [
      { key: 'Setup Feed Rate', unit: 'mm/min' },
      { key: 'Offset Feed Rate', unit: 'mm/min' },
      { key: 'Safe Height', unit: 'mm' },
      { key: 'Slat Height', unit: 'mm' },
    ],
  },
  {
    titleKey: 'scribe',
    keys: [
      { key: 'Scribe Arming Delay', unit: 's' },
      { key: 'Scribe On Delay', unit: 's' },
      { key: 'Spotting Threshold', unit: 'V' },
      { key: 'Spotting Time', unit: 's' },
      { key: 'X Pierce Offset', unit: 'mm' },
      { key: 'Y Pierce Offset', unit: 'mm' },
    ],
  },
] as const;

const buttonClass =
  'rounded-md border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:border-white/25 disabled:opacity-40';

/**
 * QtPlasmaC's PARAMETERS tab: `[PLASMA_PARAMETERS]` in `<machine>.prefs`.
 *
 * These are live machine settings, not preferences: saving writes the file *and* the
 * `plasmac.*` setpoints, so a changed PID gain takes effect on the next cut without a
 * restart. Edits stay a local draft until SAVE, and what is displayed otherwise is what the
 * backend last reported.
 */
export function PlasmaParametersScreen() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const parameters = useAppStore((s) => s.plasmaParameters);

  const [draft, setDraft] = useState<Record<string, string>>({});

  // Whatever the backend reports wins: a save, a reload or another client's edit all arrive
  // as a parameters event, and keeping a stale draft on top of that would be a lie.
  useEffect(() => {
    setDraft({});
  }, [parameters]);

  const dirtyKeys = useMemo(() => Object.keys(draft), [draft]);

  if (!parameters) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
        data-e2e="plasma-parameters-unavailable"
      >
        {t('parameters.unavailable')}
      </div>
    );
  }

  const valueOf = (key: string): string => {
    if (key in draft) return draft[key];
    const value = parameters.values[key];
    return value === undefined ? '' : String(value);
  };

  const save = () => {
    const values: Record<string, number> = {};
    for (const key of dirtyKeys) {
      const parsed = Number(draft[key]);
      if (Number.isFinite(parsed)) values[key] = parsed;
    }
    if (Object.keys(values).length > 0) commands.saveParameters(values);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-e2e="plasma-parameters">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-parameters-save"
          disabled={dirtyKeys.length === 0}
          onClick={save}
        >
          {t('parameters.save')}
        </button>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-parameters-revert"
          disabled={dirtyKeys.length === 0}
          onClick={() => setDraft({})}
        >
          {t('parameters.revert')}
        </button>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-parameters-reload"
          onClick={() => commands.reloadConfig()}
        >
          {t('parameters.reload')}
        </button>
        {dirtyKeys.length > 0 && (
          <span className="text-sm text-amber-300" data-e2e="plasma-parameters-dirty">
            {t('parameters.unsaved', { count: dirtyKeys.length })}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
        {PARAMETER_GROUPS.map((group) => (
          <section key={group.titleKey} data-e2e={`plasma-parameters-group-${group.titleKey}`}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(`parameters.group.${group.titleKey}`)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.keys.map(({ key, unit, ...rest }) => (
                <TouchNumericPickerField
                  key={key}
                  label={t(`parameters.key.${key}`, { defaultValue: key })}
                  unit={unit || undefined}
                  integerOnly={'integer' in rest && rest.integer === true}
                  value={valueOf(key)}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [key]: value }))}
                  data-e2e={`plasma-parameter-${key.replace(/\s+/g, '-').toLowerCase()}`}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="text-xs text-muted-foreground" data-e2e="plasma-parameters-path">
        {parameters.path}
      </div>
    </div>
  );
}
