import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TouchSelectField } from '@/components/ui/TouchSelectField';
import { MacroToggleSwitch } from '@/components/macros/MacroToggleSwitch';
import { useAppStore } from '@/store';
import {
  MACRO_QUEUE_WORK_OFFSETS,
  formatMacroQueueSetupGcode,
  type MacroQueueProgramSetup,
  type MacroQueueWorkOffset,
} from '@/types/macroQueueSetup';
import { cn } from '@/lib/utils';
import { dialogFooterTouchButtonClass } from '@/lib/dialogFormSubmit';

const workOffsetOptions = MACRO_QUEUE_WORK_OFFSETS.map((w) => ({ value: w, label: w }));

export function ProgramQueueSetupBlock() {
  const { t } = useTranslation('components');
  const unitsOptions = useMemo(
    () => [
      { value: 'G21' as const, label: t('queueSetup.unitG21') },
      { value: 'G20' as const, label: t('queueSetup.unitG20') },
    ],
    [t],
  );
  const setup = useAppStore((s) => s.macroQueueProgramSetup);
  const setMacroQueueProgramSetup = useAppStore((s) => s.setMacroQueueProgramSetup);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<MacroQueueProgramSetup>(setup);

  useEffect(() => {
    if (dialogOpen) setDraft(setup);
  }, [dialogOpen, setup]);

  const summary = formatMacroQueueSetupGcode(setup);

  return (
    <>
      <button
        type="button"
        data-e2e="macros-program-head-block"
        className={cn(
          'flex flex-col gap-1 rounded-lg border border-border/50 surface p-3 text-left w-full',
          'hover:bg-white/20 transition-colors cursor-pointer',
        )}
        onClick={() => setDialogOpen(true)}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('queueSetup.programHeader')}
        </span>
        <span
          className="text-sm font-medium text-foreground font-mono whitespace-pre-line line-clamp-2 overflow-hidden"
          title={summary}
        >
          {summary}
        </span>
        <span className="text-xs text-muted-foreground">{t('queueSetup.tapToEdit')}</span>
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          title={t('queueSetup.dialogTitle')}
          className="max-w-md"
          data-e2e="macros-program-head-dialog"
        >
          <div className="flex flex-col gap-4 py-2">
            <TouchSelectField
              label={t('queueSetup.workOffset')}
              value={draft.workOffset}
              onChange={(v) =>
                setDraft((d) => ({ ...d, workOffset: v as MacroQueueWorkOffset }))
              }
              options={workOffsetOptions}
              dialogTitle={t('queueSetup.dialogWorkOffset')}
              data-e2e="macros-program-head-wcs"
            />
            <TouchSelectField
              label={t('queueSetup.units')}
              value={draft.units}
              onChange={(v) =>
                setDraft((d) => ({ ...d, units: v as MacroQueueProgramSetup['units'] }))
              }
              options={unitsOptions}
              dialogTitle={t('queueSetup.dialogUnits')}
              data-e2e="macros-program-head-units"
            />
            <div>
              <MacroToggleSwitch
                checked={draft.retractZToMachineZero}
                label={t('queueSetup.retractZToMachineZero')}
                ariaLabelOn={t('queueSetup.retractZToMachineZeroOn')}
                ariaLabelOff={t('queueSetup.retractZToMachineZeroOff')}
                data-e2e="macros-program-head-z-retract"
                onCheckedChange={() =>
                  setDraft((d) => ({
                    ...d,
                    retractZToMachineZero: !d.retractZToMachineZero,
                  }))
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('queueSetup.retractZToMachineZeroHint')}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className={dialogFooterTouchButtonClass}
              onClick={() => setDialogOpen(false)}
            >
              {t('queueSetup.cancel')}
            </Button>
            <Button
              type="button"
              className={dialogFooterTouchButtonClass}
              onClick={() => {
                setMacroQueueProgramSetup(draft);
                setDialogOpen(false);
              }}
            >
              {t('queueSetup.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
