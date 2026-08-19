import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatHotkey,
  hotkeyFromKeyboardEvent,
  type HotkeyDisplayLabels,
  type VirtualSidebarHotkey,
} from '@/lib/virtualSidebarHotkeys';
import { cn } from '@/lib/utils';

type HotkeyCaptureButtonProps = {
  value: VirtualSidebarHotkey | null;
  onChange: (value: VirtualSidebarHotkey | null) => void;
  isCapturing: boolean;
  onCapturingChange: (capturing: boolean) => void;
  'data-e2e'?: string;
};

export function HotkeyCaptureButton({
  value,
  onChange,
  isCapturing,
  onCapturingChange,
  'data-e2e': dataE2e,
}: HotkeyCaptureButtonProps) {
  const { t } = useTranslation('settings');
  const buttonRef = useRef<HTMLButtonElement>(null);

  const hotkeyLabels = useMemo<HotkeyDisplayLabels>(
    () => ({
      ctrl: t('virtualSidebarHotkeys.modifiers.ctrl'),
      alt: t('virtualSidebarHotkeys.modifiers.alt'),
      shift: t('virtualSidebarHotkeys.modifiers.shift'),
      meta: t('virtualSidebarHotkeys.modifiers.meta'),
      space: t('virtualSidebarHotkeys.modifiers.space'),
    }),
    [t],
  );

  const stopCapturing = useCallback(() => {
    onCapturingChange(false);
  }, [onCapturingChange]);

  useEffect(() => {
    if (!isCapturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        stopCapturing();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        onChange(null);
        stopCapturing();
        return;
      }

      const hotkey = hotkeyFromKeyboardEvent(event);
      if (!hotkey) return;

      onChange(hotkey);
      stopCapturing();
    };

    document.addEventListener('keydown', onKeyDown, true);
    buttonRef.current?.focus();

    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isCapturing, onChange, stopCapturing]);

  const label = isCapturing
    ? t('virtualSidebarHotkeys.pressKeys')
    : value
      ? formatHotkey(value, hotkeyLabels)
      : t('virtualSidebarHotkeys.notSet');

  return (
    <div className="flex items-center gap-2" data-hotkey-capture={isCapturing ? 'true' : undefined}>
      <button
        ref={buttonRef}
        type="button"
        data-e2e={dataE2e}
        aria-pressed={isCapturing}
        onClick={() => onCapturingChange(!isCapturing)}
        className={cn(
          'inline-flex min-w-[8rem] items-center justify-center rounded-md border px-3 py-1.5 text-xs font-mono transition-colors',
          'border-border/60 bg-background/60 text-foreground hover:bg-muted/70',
          isCapturing && 'border-primary/70 bg-primary/10 ring-2 ring-primary/40',
        )}
      >
        {label}
      </button>
      {value && !isCapturing && (
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => onChange(null)}
        >
          {t('virtualSidebarHotkeys.clear')}
        </button>
      )}
    </div>
  );
}
