import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { TOOL_TOUCH_OFF_ACTION } from '@/api/toolTableCommands';
import type { CoordinateAxisKey } from '@/api/coordinateSystems';
import {
  TouchNumericDialogFooter,
  TouchNumericEntry,
  touchNumericDialogContentClassName,
} from '@/components/numeric';
import {
  touchSelectTriggerLayoutClass,
  TouchSelectField,
} from '@/components/ui/TouchSelectField';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { useToolMachineUiProfile } from '@/hooks/useToolMachineUiProfile';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import { cn } from '@/lib/utils';

const axisTouchTriggerClass = cn(
  'w-full rounded-md border border-input bg-background/80 px-4 py-3.5',
  'text-foreground touch-manipulation',
  'focus:outline-none focus:ring-2 focus:ring-ring',
  touchSelectTriggerLayoutClass,
);

type ToolTouchOffDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display e.g. “T3” / name — title only. */
  toolSummary?: string;
};

export function ToolTouchOffDialog({
  open,
  onOpenChange,
  toolSummary,
}: ToolTouchOffDialogProps) {
  const { t } = useTranslation('tools');
  const sendCommand = useSendCommand();
  const { activeAxes } = useToolMachineUiProfile();
  const [axis, setAxis] = useState<CoordinateAxisKey>('z');
  const [valueText, setValueText] = useState('0');
  const [busy, setBusy] = useState(false);
  const pendingCommandIdRef = useRef<string | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const parsedValue = useMemo(() => parseTouchNumericForCommit(valueText), [valueText]);
  const canApply = parsedValue !== null && !busy;

  useEffect(() => {
    if (!open) {
      pendingCommandIdRef.current = null;
      setBusy(false);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    setAxis((prev) => {
      if (activeAxes.includes(prev)) {
        return prev;
      }
      if (activeAxes.includes('z')) {
        return 'z';
      }
      return activeAxes[0] ?? 'z';
    });
  }, [open, activeAxes]);

  usePendingWsCommandResult(pendingCommandIdRef, {
    onResult: (r) => {
      pendingCommandIdRef.current = null;
      setBusy(false);
      if (r.ok) onOpenChangeRef.current(false);
    },
  });

  const handleApply = () => {
    if (parsedValue === null) return;
    const commandId = generateCommandId();
    pendingCommandIdRef.current = commandId;
    setBusy(true);
    sendCommand('tool', TOOL_TOUCH_OFF_ACTION, { axis, value: parsedValue }, commandId);
  };

  const title = toolSummary
    ? t('touchOffDialog.titleWithTool', { summary: toolSummary })
    : t('touchOffDialog.title');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className={touchNumericDialogContentClassName}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TouchSelectField
            label={t('touchOffDialog.axis')}
            value={axis}
            onChange={(v) => setAxis(v as CoordinateAxisKey)}
            options={activeAxes.map((a) => ({
              value: a,
              label: a.toUpperCase(),
            }))}
            triggerClassName={axisTouchTriggerClass}
            pickerDataE2e="tool-touch-off-axis-picker"
          />
          <div className="sm:col-span-2">
            <TouchNumericEntry
              value={valueText}
              onChange={setValueText}
              label={t('touchOffDialog.targetValue')}
              keypadMode="always"
              showPreview
              layoutSize="touch"
            />
          </div>
        </div>
        <TouchNumericDialogFooter
          onCancel={() => onOpenChange(false)}
          onConfirm={handleApply}
          cancelLabel={t('touchOffDialog.cancel')}
          confirmLabel={t('touchOffDialog.apply')}
          confirmDisabled={!canApply}
        />
      </DialogContent>
    </Dialog>
  );
}
