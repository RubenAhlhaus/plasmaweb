import { useCallback, useEffect, useMemo, useRef } from 'react';

export type UseTouchNumericModalEscapeStackOptions = {
  /** When outer dialog closes, reset inner count of open numeric pickers. */
  outerOpen: boolean;
  /** When `true`: outer dialog stays open on first Escape (e.g. preset sub-dialog still open). */
  blockOuterEscape?: boolean;
};

/**
 * Stack Escape with nested TouchNumericPickerField dialogs: close inner first,
 * then optional further blockers, then outer (see CoordinateSystemsDialog).
 */
export function useTouchNumericModalEscapeStack(options: UseTouchNumericModalEscapeStackOptions) {
  const { outerOpen, blockOuterEscape = false } = options;
  const countRef = useRef(0);

  useEffect(() => {
    if (!outerOpen) countRef.current = 0;
  }, [outerOpen]);

  const onPickerDialogOpenChange = useCallback((isOpen: boolean) => {
    countRef.current += isOpen ? 1 : -1;
    if (countRef.current < 0) countRef.current = 0;
  }, []);

  const onOuterEscapeKeyDown = useCallback((): boolean | void => {
    if (countRef.current > 0) return false;
    if (blockOuterEscape) return false;
  }, [blockOuterEscape]);

  const touchNumericStackProps = useMemo(
    () => ({ onDialogOpenChange: onPickerDialogOpenChange }),
    [onPickerDialogOpenChange],
  );

  return { onPickerDialogOpenChange, onOuterEscapeKeyDown, touchNumericStackProps };
}
