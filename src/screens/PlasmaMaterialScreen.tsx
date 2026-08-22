import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TouchNumericPickerField } from '@/components/numeric';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { useAppStore } from '@/store';
import type { PlasmaMaterial } from '@/store/types';

type MaterialValueKey = keyof Omit<PlasmaMaterial, 'number' | 'name' | 'temporary'>;

type MaterialField = { key: MaterialValueKey; labelKey: string; unit: string };

/** The thirteen editable numbers of a material, in the order QtPlasmaC's MATERIAL tab shows. */
const MATERIAL_FIELDS: readonly MaterialField[] = [
  { key: 'pierceHeight', labelKey: 'pierceHeight', unit: 'mm' },
  { key: 'pierceDelay', labelKey: 'pierceDelay', unit: 's' },
  { key: 'puddleJumpHeight', labelKey: 'puddleJumpHeight', unit: '%' },
  { key: 'puddleJumpDelay', labelKey: 'puddleJumpDelay', unit: 's' },
  { key: 'cutHeight', labelKey: 'cutHeight', unit: 'mm' },
  { key: 'cutSpeed', labelKey: 'cutSpeed', unit: 'mm/min' },
  { key: 'cutAmps', labelKey: 'cutAmps', unit: 'A' },
  { key: 'cutVolts', labelKey: 'cutVolts', unit: 'V' },
  { key: 'kerfWidth', labelKey: 'kerfWidth', unit: 'mm' },
  { key: 'pauseAtEnd', labelKey: 'pauseAtEnd', unit: 's' },
  { key: 'gasPressure', labelKey: 'gasPressure', unit: '' },
  { key: 'cutMode', labelKey: 'cutMode', unit: '' },
  { key: 'thickness', labelKey: 'thickness', unit: 'mm' },
];

type Draft = { name: string; values: Record<string, string> };

const inputClass =
  'w-full rounded-md border border-border/40 bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

function toDraft(material: PlasmaMaterial): Draft {
  const values: Record<string, string> = {};
  for (const field of MATERIAL_FIELDS) {
    values[field.key] = String(material[field.key]);
  }
  return { name: material.name, values };
}

function draftNumbers(draft: Draft): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, raw] of Object.entries(draft.values)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) values[key] = parsed;
  }
  return values;
}

/** The next free material number, so NEW never lands on an existing one. */
function nextFreeNumber(materials: PlasmaMaterial[]): number {
  const taken = new Set(materials.map((m) => m.number));
  let candidate = 1;
  while (taken.has(candidate)) candidate += 1;
  return candidate;
}

/**
 * QtPlasmaC's MATERIAL tab: the cut materials in `<machine>_material.cfg`.
 *
 * Selecting a material writes its values to the `plasmac.*` setpoints — it is what makes a
 * cut cut — so the list is a machine control, not a preference. Edits are a local draft until
 * SAVE; everything that comes back arrives as a `plasma.materials.changed` event, so what is
 * shown is always what the file and HAL agree on.
 *
 * Materials numbered from 1000000 up come from a program's magic comment and only live for
 * the session, so they can be selected but not edited or deleted.
 */
export function PlasmaMaterialScreen() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const materials = useAppStore((s) => s.plasmaMaterials);

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => materials?.materials ?? [], [materials]);
  const selected = materials?.selected ?? null;
  const shown = editing ?? selected;
  const material = list.find((m) => m.number === shown) ?? null;

  // The file is the source of truth: when it changes under us, drop the draft rather than
  // keep editing a material that may no longer look like that.
  useEffect(() => {
    setDraft(null);
    setCreating(false);
  }, [materials]);

  const activeDraft = draft ?? (material ? toDraft(material) : null);
  const dirty = draft !== null;

  if (!materials) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
        data-e2e="plasma-materials-unavailable"
      >
        {t('material.unavailable')}
      </div>
    );
  }

  const setValue = (key: string, value: string) => {
    setDraft((prev) => {
      const base = prev ?? (material ? toDraft(material) : { name: '', values: {} });
      return { ...base, values: { ...base.values, [key]: value } };
    });
  };

  const startNew = () => {
    const number = nextFreeNumber(list);
    setEditing(number);
    setCreating(true);
    setDraft({
      name: t('material.newName', { number }),
      values: Object.fromEntries(
        MATERIAL_FIELDS.map((field) => [
          field.key,
          material ? String(material[field.key]) : '0',
        ]),
      ),
    });
  };

  const save = () => {
    if (!activeDraft || shown === null) return;
    commands.saveMaterial(shown, activeDraft.name, draftNumbers(activeDraft));
    setCreating(false);
  };

  const readOnly = material?.temporary === true;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]" data-e2e="plasma-material">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-md border border-border/40 bg-card px-3 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70"
            data-e2e="plasma-material-new"
            onClick={startNew}
          >
            {t('material.new')}
          </button>
          <button
            type="button"
            className="flex-1 rounded-md border border-border/40 bg-card px-3 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70"
            data-e2e="plasma-material-reload"
            onClick={() => commands.reloadConfig()}
          >
            {t('material.reload')}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40">
          {list.map((entry) => {
            const isSelected = entry.number === selected;
            const isShown = entry.number === shown;
            return (
              <button
                key={entry.number}
                type="button"
                data-e2e={`plasma-material-row-${entry.number}`}
                className={`flex w-full items-center justify-between gap-2 border-b border-border/25 px-3 py-2 text-left text-sm ${
                  isShown ? 'bg-card/80 text-foreground' : 'text-muted-foreground hover:bg-card'
                }`}
                onClick={() => {
                  setEditing(entry.number);
                  setDraft(null);
                  setCreating(false);
                  commands.selectMaterial(entry.number);
                }}
              >
                <span className="truncate">
                  {String(entry.number).padStart(5, '0')}: {entry.name}
                </span>
                <span className="flex shrink-0 gap-1 text-[0.65rem] uppercase">
                  {entry.temporary && (
                    <span className="rounded bg-[color:var(--plasma-led)]/15 px-1 text-[color:var(--plasma-led)]">
                      {t('material.temporary')}
                    </span>
                  )}
                  {entry.number === materials.default && (
                    <span className="rounded bg-primary/15 px-1 text-primary">
                      {t('material.default')}
                    </span>
                  )}
                  {isSelected && (
                    <span className="rounded bg-primary/15 px-1 text-primary">
                      {t('material.inUse')}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {activeDraft && shown !== null ? (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <label className="text-sm text-muted-foreground" htmlFor="plasma-material-name">
                {t('material.name')}
              </label>
              <input
                id="plasma-material-name"
                type="text"
                className={inputClass}
                data-e2e="plasma-material-name"
                value={activeDraft.name}
                disabled={readOnly}
                onChange={(e) =>
                  setDraft((prev) => ({
                    name: e.target.value,
                    values: (prev ?? toDraft(material as PlasmaMaterial)).values,
                  }))
                }
              />
            </div>
            <div className="text-sm text-muted-foreground" data-e2e="plasma-material-number">
              {t('material.number')}: {String(shown).padStart(5, '0')}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MATERIAL_FIELDS.map((field) => (
              <TouchNumericPickerField
                key={field.key}
                label={t(`material.field.${field.labelKey}`)}
                unit={field.unit || undefined}
                value={activeDraft.values[field.key] ?? ''}
                disabled={readOnly}
                onChange={(value) => setValue(field.key, value)}
                data-e2e={`plasma-material-${field.key}`}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pb-2">
            <button
              type="button"
              className="rounded-md border border-border/40 bg-card px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40"
              data-e2e="plasma-material-save"
              disabled={readOnly || (!dirty && !creating)}
              onClick={save}
            >
              {t('material.save')}
            </button>
            <button
              type="button"
              className="rounded-md border border-border/40 bg-card px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40"
              data-e2e="plasma-material-revert"
              disabled={!dirty && !creating}
              onClick={() => {
                setDraft(null);
                setCreating(false);
                setEditing(selected);
              }}
            >
              {t('material.revert')}
            </button>
            <button
              type="button"
              className="rounded-md border border-border/40 bg-card px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40"
              data-e2e="plasma-material-set-default"
              disabled={readOnly || creating || shown === materials.default}
              onClick={() => commands.setDefaultMaterial(shown)}
            >
              {t('material.setDefault')}
            </button>
            <button
              type="button"
              className="rounded-md border border-destructive/50 bg-destructive/15 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-destructive hover:border-destructive disabled:opacity-40"
              data-e2e="plasma-material-delete"
              disabled={readOnly || creating || list.length <= 1}
              onClick={() => {
                commands.deleteMaterial(shown);
                setEditing(null);
              }}
            >
              {t('material.delete')}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center justify-center text-sm text-muted-foreground"
          data-e2e="plasma-material-empty"
        >
          {t('material.empty')}
        </div>
      )}
    </div>
  );
}
