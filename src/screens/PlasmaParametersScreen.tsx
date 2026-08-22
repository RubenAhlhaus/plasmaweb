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
/**
 * The `[PLASMA_PARAMETERS]` keys, grouped the way QtPlasmaC's PARAMETERS tab groups them.
 *
 * Keys are QtPlasmaC's own spelling because that is the contract with the prefs file — the
 * backend writes and reads exactly these strings, and inventing UI names for them would mean
 * two names for one setting. The unit, the precision and the bounds are *not* here: they
 * depend on the machine's INI and on each other, so the backend reports them per parameter.
 */
const PARAMETER_GROUPS = [
  {
    titleKey: 'arc',
    keys: [
      'Arc Fail Timeout',
      'Arc Maximum Starts',
      'Arc Restart Delay',
      'Arc OK High',
      'Arc OK Low',
      'Arc Voltage Scale',
      'Arc Voltage Offset',
    ],
  },
  {
    titleKey: 'thc',
    keys: [
      'Pid P Gain',
      'Pid I Gain',
      'Pid D Gain',
      'THC Delay',
      'THC Threshold',
      'THC Sample Counts',
      'THC Sample Threshold',
      'Height Per Volt',
      'Velocity Anti Dive Threshold',
      'Void Sense Slope',
    ],
  },
  {
    titleKey: 'probe',
    keys: [
      'Probe Feed Rate',
      'Probe Start Height',
      'Float Switch Travel',
      'Skip IHS Distance',
      'Ohmic Probe Offset',
      'Ohmic Maximum Attempts',
    ],
  },
  {
    titleKey: 'motion',
    keys: ['Setup Feed Rate', 'Offset Feed Rate', 'Safe Height', 'Slat Height'],
  },
  {
    titleKey: 'scribe',
    keys: [
      'Scribe Arming Delay',
      'Scribe On Delay',
      'Spotting Threshold',
      'Spotting Time',
      'X Pierce Offset',
      'Y Pierce Offset',
    ],
  },
] as const;

/**
 * `[LASER_OFFSET]` and `[CAMERA_OFFSET]`: where each peripheral sits relative to the torch.
 * Sheet alignment sets the origin at the *peripheral's* position, so these are the numbers
 * every aligned job depends on. Zero on both axes means the machine has none fitted, and the
 * alignment button hides itself accordingly.
 */
const PERIPHERALS: Array<{ kind: 'laser' | 'camera' }> = [{ kind: 'laser' }, { kind: 'camera' }];

/**
 * `[COLOR_OPTIONS]`, in the order QtPlasmaC's own settings screen lists them. Changing one
 * here changes it for QtPlasmaC too — it is the same file, and a shop runs one look.
 */
const COLOR_NAMES = [
  'foreground',
  'highlight',
  'led',
  'background',
  'backgroundAlt',
  'frames',
  'estop',
  'disabled',
  'preview',
] as const;

/**
 * `[OFFSET_PROBING]`, which is not a `[PLASMA_PARAMETERS]` key but belongs on the same screen:
 * where the probe sits relative to the torch, and how long it takes to deploy. Zero on both
 * axes means the probe is under the torch, which is the common case.
 */
const OFFSET_PROBING_FIELDS: Array<{ key: string; unit: string }> = [
  { key: 'X axis', unit: 'mm' },
  { key: 'Y axis', unit: 'mm' },
  { key: 'Delay', unit: 's' },
];

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
  const [probeDraft, setProbeDraft] = useState<Record<string, string>>({});
  const [peripheralDraft, setPeripheralDraft] = useState<Record<string, string>>({});
  const alignment = useAppStore((s) => s.plasmaAlignment);
  const capabilities = useAppStore((s) => s.plasmaCapabilities);

  /**
   * Parameters that save, read back, and reach no pin on this LinuxCNC. Marked rather than
   * hidden: the value is real in the prefs file and QtPlasmaC on a newer build would use it.
   */
  const ineffective = useMemo(
    () => new Set((capabilities?.ineffectiveParameters ?? []).map((entry) => entry.key)),
    [capabilities],
  );

  // Whatever the backend reports wins: a save, a reload or another client's edit all arrive
  // as a parameters event, and keeping a stale draft on top of that would be a lie.
  useEffect(() => {
    setDraft({});
    setProbeDraft({});
    setPeripheralDraft({});
  }, [parameters]);

  const dirtyKeys = useMemo(
    () => [...Object.keys(draft), ...Object.keys(probeDraft), ...Object.keys(peripheralDraft)],
    [draft, probeDraft, peripheralDraft],
  );

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

  /**
   * Refuse an out-of-range value where it is typed rather than where it lands. The backend
   * checks again — it owns the machine — but a bound the operator learns about only after
   * pressing SAVE is a bound they have already worked around.
   */
  const validator = (key: string) => (parsed: number): string | null => {
    const limit = parameters.limits?.[key];
    if (!limit) return null;
    if (parsed < limit.minimum || parsed > limit.maximum) {
      return t('parameters.outOfRange', {
        minimum: limit.minimum,
        maximum: Number.isFinite(limit.maximum) ? limit.maximum : '∞',
        unit: limit.unit,
      });
    }
    return null;
  };

  const save = () => {
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(draft)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) values[key] = parsed;
    }
    if (Object.keys(values).length > 0) commands.saveParameters(values);

    // The offset probe lives in its own prefs section, so it saves through its own command.
    const probeValues: Record<string, number> = {};
    for (const [key, value] of Object.entries(probeDraft)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) probeValues[key] = parsed;
    }
    if (Object.keys(probeValues).length > 0) commands.saveOffsetProbing(probeValues);

    // Each peripheral has its own prefs section, so each saves on its own.
    for (const { kind } of PERIPHERALS) {
      const values: Record<string, number> = {};
      for (const axis of ['X axis', 'Y axis']) {
        const value = peripheralDraft[`${kind}.${axis}`];
        if (value === undefined) continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed)) values[axis] = parsed;
      }
      if (Object.keys(values).length > 0) commands.savePeripheralOffset(kind, values);
    }
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
          onClick={() => {
            setDraft({});
            setProbeDraft({});
            setPeripheralDraft({});
          }}
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
        <section data-e2e="plasma-parameters-group-offsetProbing">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('parameters.group.offsetProbing')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {OFFSET_PROBING_FIELDS.map(({ key, unit }) => (
              <TouchNumericPickerField
                key={key}
                label={t(`parameters.offsetProbing.${key}`, { defaultValue: key })}
                unit={unit}
                value={
                  key in probeDraft
                    ? probeDraft[key]
                    : String(parameters.offsetProbing?.[key] ?? 0)
                }
                onChange={(value) => setProbeDraft((prev) => ({ ...prev, [key]: value }))}
                data-e2e={`plasma-offset-probe-${key.replace(/\s+/g, '-').toLowerCase()}`}
              />
            ))}
          </div>
        </section>

        {capabilities && (
          <section data-e2e="plasma-parameters-group-capabilities">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('parameters.group.capabilities')}
            </h2>
            {Object.entries(capabilities.features).filter(([, f]) => !f.available).length ===
            0 ? (
              <p className="text-sm text-muted-foreground" data-e2e="plasma-capabilities-all">
                {t('parameters.capabilities.all')}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {Object.entries(capabilities.features)
                  .filter(([, feature]) => !feature.available)
                  .map(([name, feature]) => (
                    <li
                      key={name}
                      className="text-muted-foreground"
                      data-e2e={`plasma-capability-${name}`}
                    >
                      <span className="text-amber-300">{feature.description}</span>{' '}
                      {t('parameters.capabilities.needs', {
                        pins: feature.missing.join(', '),
                      })}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}

        {parameters.colors && (
          <section data-e2e="plasma-parameters-group-colors">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('parameters.group.colors')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {COLOR_NAMES.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm">
                  <input
                    type="color"
                    className="h-9 w-12 shrink-0 rounded border border-white/10 bg-transparent"
                    data-e2e={`plasma-color-${name}`}
                    value={parameters.colors?.[name] ?? '#000000'}
                    onChange={(event) =>
                      commands.saveColors({ [name]: event.target.value })
                    }
                  />
                  <span className="text-muted-foreground">
                    {t(`parameters.color.${name}`, { defaultValue: name })}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        <section data-e2e="plasma-parameters-group-gui">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('parameters.group.gui')}
          </h2>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-emerald-400"
              data-e2e="plasma-gui-keyboard-shortcuts"
              checked={parameters.guiOptions?.keyboardShortcuts === true}
              onChange={(event) =>
                commands.saveGuiOption('keyboardShortcuts', event.target.checked)
              }
            />
            <span>
              {t('parameters.gui.keyboardShortcuts')}
              <span className="ml-2 text-xs text-muted-foreground">
                {t('parameters.gui.keyboardShortcutsHint')}
              </span>
            </span>
          </label>
        </section>

        <section data-e2e="plasma-parameters-group-peripherals">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('parameters.group.peripherals')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PERIPHERALS.map(({ kind }) =>
              ['X axis', 'Y axis'].map((axis) => {
                const key = `${kind}.${axis}`;
                return (
                  <TouchNumericPickerField
                    key={key}
                    label={t(`parameters.peripheral.${kind}`, { axis }) + ` ${axis}`}
                    unit="mm"
                    value={
                      key in peripheralDraft
                        ? peripheralDraft[key]
                        : String(alignment?.offsets?.[kind]?.[axis] ?? 0)
                    }
                    onChange={(value) =>
                      setPeripheralDraft((prev) => ({ ...prev, [key]: value }))
                    }
                    data-e2e={`plasma-peripheral-${kind}-${axis.replace(/\s+/g, '-').toLowerCase()}`}
                  />
                );
              }),
            )}
          </div>
        </section>

        {PARAMETER_GROUPS.map((group) => (
          <section key={group.titleKey} data-e2e={`plasma-parameters-group-${group.titleKey}`}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(`parameters.group.${group.titleKey}`)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.keys.map((key) => {
                const limit = parameters.limits?.[key];
                const noPin = ineffective.has(key);
                return (
                  <TouchNumericPickerField
                    key={key}
                    label={t(`parameters.key.${key}`, { defaultValue: key })}
                    labelTooltip={noPin ? t('parameters.noPin') : undefined}
                    labelAccessory={
                      noPin ? (
                        <span
                          className="text-xs text-amber-300"
                          title={t('parameters.noPin')}
                          data-e2e={`plasma-parameter-ineffective-${key
                            .replace(/\s+/g, '-')
                            .toLowerCase()}`}
                        >
                          !
                        </span>
                      ) : undefined
                    }
                    unit={limit?.unit || undefined}
                    integerOnly={limit?.decimals === 0}
                    value={valueOf(key)}
                    onChange={(value) => setDraft((prev) => ({ ...prev, [key]: value }))}
                    validateParsed={validator(key)}
                    data-e2e={`plasma-parameter-${key.replace(/\s+/g, '-').toLowerCase()}`}
                  />
                );
              })}
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
