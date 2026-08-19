import type { ReactNode } from 'react';

type MacroFieldHintWrapProps = {
  /** When null, hover/focus still call `onHoverHint(null)` (no graphic highlight). */
  hintKey: string | null;
  onHoverHint: (key: string | null) => void;
  children: ReactNode;
};

export function MacroFieldHintWrap({ hintKey, onHoverHint, children }: MacroFieldHintWrapProps) {
  return (
    <div
      onMouseEnter={() => onHoverHint(hintKey)}
      onMouseLeave={() => onHoverHint(null)}
      onFocusCapture={() => onHoverHint(hintKey)}
      onBlurCapture={() => onHoverHint(null)}
    >
      {children}
    </div>
  );
}
