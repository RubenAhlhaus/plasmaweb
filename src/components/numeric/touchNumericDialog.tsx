import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { dialogFooterTouchButtonClass } from '@/lib/dialogFormSubmit';
import { cn } from '@/lib/utils';

/**
 * Shell for dialogs with {@link TouchNumericEntry} + footer (single column, touch keypad).
 * Same sizing as e.g. {@link TouchNumericPickerField}.
 */
export const touchNumericDialogContentClassName =
  'w-full max-w-2xl p-5 sm:p-6 flex flex-col gap-4 min-h-0 max-h-[92vh] overflow-y-auto';

/**
 * Wider shell (e.g. spindle/feed two columns from `lg` up).
 */
export const touchNumericDialogContentWideClassName =
  'w-full max-w-5xl p-5 sm:p-6 max-h-[92vh] flex flex-col gap-4 overflow-y-auto lg:max-h-[88vh]';

/** Same grid class as {@link TouchNumericDialogFooter} (e.g. tooltip around confirm). */
export const touchNumericDialogFooterGridClassName =
  'mt-auto w-full shrink-0 grid grid-cols-2 gap-3 !justify-stretch';

export type TouchNumericDialogFooterProps = {
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  cancelVariant?: ComponentProps<typeof Button>['variant'];
  confirmVariant?: ComponentProps<typeof Button>['variant'];
  className?: string;
  cancelDataE2e?: string;
  confirmDataE2e?: string;
};

/**
 * Default footer for touch numeric entry: **Cancel** | **Primary** side by side,
 * same min height (`dialogFooterTouchButtonClass`).
 */
export function TouchNumericDialogFooter({
  onCancel,
  onConfirm,
  cancelLabel,
  confirmLabel,
  confirmDisabled = false,
  cancelVariant = 'outline',
  confirmVariant = 'secondary',
  className,
  cancelDataE2e,
  confirmDataE2e,
}: TouchNumericDialogFooterProps) {
  const { t } = useTranslation('components');
  const resolvedCancel = cancelLabel ?? t('touchNumeric.cancel');
  const resolvedConfirm = confirmLabel ?? t('touchNumeric.confirm');

  return (
    <DialogFooter className={cn(touchNumericDialogFooterGridClassName, className)}>
      <Button
        type="button"
        variant={cancelVariant}
        size="lg"
        className={cn(dialogFooterTouchButtonClass, 'w-full min-w-0')}
        onClick={onCancel}
        data-e2e={cancelDataE2e}
      >
        {resolvedCancel}
      </Button>
      <Button
        type="button"
        variant={confirmVariant}
        size="lg"
        className={cn(
          dialogFooterTouchButtonClass,
          'w-full min-w-0',
          confirmDisabled && 'pointer-events-none',
        )}
        disabled={confirmDisabled}
        onClick={onConfirm}
        data-e2e={confirmDataE2e}
      >
        {resolvedConfirm}
      </Button>
    </DialogFooter>
  );
}
