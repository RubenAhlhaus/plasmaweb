import { useCallback, useState } from 'react';
import type { TouchNumericStackProps } from '@/types/macros';

export function useMacroHintDialogHandlers(touchNumericStackProps?: TouchNumericStackProps) {
  const [hoveredHintKey, setHoveredHintKey] = useState<string | null>(null);
  const [dialogHintKey, setDialogHintKey] = useState<string | null>(null);

  const createNumericDialogOpenHandler = useCallback(
    (hintKey: string | null) => (open: boolean) => {
      touchNumericStackProps?.onDialogOpenChange?.(open);
      if (open) {
        setDialogHintKey(hintKey);
        return;
      }
      setDialogHintKey(null);
      if (hintKey) setHoveredHintKey(hintKey);
    },
    [touchNumericStackProps],
  );

  return {
    activeHintKey: dialogHintKey ?? hoveredHintKey,
    createNumericDialogOpenHandler,
    setHoveredHintKey,
  };
}
