import type { ReactNode } from 'react';
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { trySubmitDialogFormOnEnter } from '@/lib/dialogFormSubmit';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import {
  TouchNumericDialogFooter,
  touchNumericDialogContentClassName,
  touchNumericDialogContentWideClassName,
} from './touchNumericDialog';
import { TouchNumericEntry } from './TouchNumericEntry';

export type TouchNumericPickerFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  dialogTitle?: string;
  integerOnly?: boolean;
  allowEmpty?: boolean;
  unit?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Return error text or `null` if valid */
  validateParsed?: (n: number) => string | null;
  /** e.g. tooltip next to label */
  labelAccessory?: ReactNode;
  /** Hover content on field name (label) */
  labelTooltip?: ReactNode;
  /** Called when calculator dialog opens/closes (e.g. escape stack in parent modal). */
  onDialogOpenChange?: (open: boolean) => void;
  /** Trigger button received / lost focus (e.g. keyboard navigation). */
  onTriggerFocusChange?: (focused: boolean) => void;
  /** Omit visible label row (e.g. table cells); dialog title and `aria-label` still use `label` / `dialogTitle`. */
  hideLabel?: boolean;
  /** Optional panel beside the keypad (e.g. pattern preview); widens the dialog on large screens. */
  dialogAside?: ReactNode;
  /**
   * Fires when the dialog draft changes while open (`null` when the dialog closes).
   * Use for live previews that depend on the in-progress expression.
   */
  onDialogDraftChange?: (draft: string | null) => void;
  'data-e2e'?: string;
};

export function TouchNumericPickerField({
  label,
  value,
  onChange,
  dialogTitle,
  integerOnly = false,
  allowEmpty = false,
  unit,
  disabled = false,
  className,
  triggerClassName,
  validateParsed,
  labelAccessory,
  labelTooltip,
  onDialogOpenChange,
  onTriggerFocusChange,
  hideLabel = false,
  dialogAside,
  onDialogDraftChange,
  'data-e2e': dataE2e,
}: TouchNumericPickerFieldProps) {
  const { t } = useTranslation('components');
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [commitError, setCommitError] = useState<string | null>(null);
  const [focusSessionKey, setFocusSessionKey] = useState(0);

  const title = dialogTitle ?? label;

  const labelSpan = (
    <span
      id={`${baseId}-label`}
      className="block h-5 leading-5 text-sm text-muted-foreground whitespace-nowrap"
    >
      {label}
    </span>
  );

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setDraft(value);
    setCommitError(null);
    setFocusSessionKey((k) => k + 1);
    setOpen(true);
    onDialogOpenChange?.(true);
    onDialogDraftChange?.(value);
  }, [disabled, onDialogDraftChange, onDialogOpenChange, value]);

  const handleCancel = useCallback(() => {
    onDialogDraftChange?.(null);
    setOpen(false);
    setCommitError(null);
    onDialogOpenChange?.(false);
  }, [onDialogDraftChange, onDialogOpenChange]);

  const handleOk = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (allowEmpty) {
        onDialogDraftChange?.(null);
        onChange('');
        setOpen(false);
        setCommitError(null);
        onDialogOpenChange?.(false);
        return;
      }
      setCommitError(t('touchNumeric.emptyRequired'));
      return;
    }

    const n = parseTouchNumericForCommit(draft);
    if (n === null) {
      setCommitError(t('touchNumeric.invalidExpression'));
      return;
    }

    if (validateParsed) {
      const err = validateParsed(n);
      if (err != null) {
        setCommitError(err);
        return;
      }
    }

    const committed = integerOnly ? String(Math.round(n)) : String(n);
    onDialogDraftChange?.(null);
    onChange(committed);
    setOpen(false);
    setCommitError(null);
    onDialogOpenChange?.(false);
  }, [
    t,
    allowEmpty,
    draft,
    integerOnly,
    onChange,
    onDialogDraftChange,
    onDialogOpenChange,
    validateParsed,
  ]);

  return (
    <div className={cn(hideLabel ? 'space-y-0' : 'space-y-1', className)}>
      {hideLabel ? null : (
        <div className="flex h-5 items-center gap-1.5">
          {labelTooltip != null ? (
            <AppTooltip content={labelTooltip} cursor="help">
              {labelSpan}
            </AppTooltip>
          ) : (
            labelSpan
          )}
          {labelAccessory}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          data-e2e={dataE2e}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={hideLabel ? title : undefined}
          aria-labelledby={hideLabel ? undefined : `${baseId}-label`}
          onFocus={() => onTriggerFocusChange?.(true)}
          onBlur={() => onTriggerFocusChange?.(false)}
          onClick={handleOpen}
          className={cn(
            'w-full min-h-14 rounded-md border border-input bg-background/80 px-4 py-3 text-right text-lg',
            'text-foreground tabular-nums touch-manipulation',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            value.trim() === '' && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          {value.trim() !== '' ? value : '—'}
        </button>
        {unit ? (
          <span className="shrink-0 self-center text-sm text-muted-foreground tabular-nums">{unit}</span>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && handleCancel()}>
        <DialogContent
          title={title}
          className={
            dialogAside != null
              ? touchNumericDialogContentWideClassName
              : touchNumericDialogContentClassName
          }
          onKeyDown={(e) => trySubmitDialogFormOnEnter(e, true, handleOk)}
        >
          <div
            className={cn(
              'flex min-h-0 w-full flex-1 flex-col gap-4',
              dialogAside != null && 'lg:flex-row lg:items-stretch lg:gap-6',
            )}
          >
            {dialogAside != null ? (
              <div className="mx-auto min-w-0 w-full max-w-sm shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/20 p-2 max-lg:max-h-[min(40vh,22rem)] lg:mx-0 lg:w-[min(22rem,38vw)]">
                {dialogAside}
              </div>
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
              <TouchNumericEntry
                id={`${baseId}-entry`}
                value={draft}
                onChange={(v) => {
                  setDraft(v);
                  setCommitError(null);
                  onDialogDraftChange?.(v);
                }}
                keypadMode="always"
                showPreview
                layoutSize="touch"
                integerOnly={integerOnly}
                errorText={commitError ?? undefined}
                focusSelectSessionKey={open ? focusSessionKey : undefined}
                data-e2e={dataE2e ? `${dataE2e}-touch-entry` : undefined}
              />
              <TouchNumericDialogFooter
                onCancel={handleCancel}
                onConfirm={handleOk}
                cancelDataE2e={dataE2e ? `${dataE2e}-cancel` : 'touch-numeric-picker-cancel'}
                confirmDataE2e={dataE2e ? `${dataE2e}-ok` : 'touch-numeric-picker-ok'}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
