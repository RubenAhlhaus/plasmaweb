import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppStore } from '@/store';
import { useSendCommand } from '@/api/backendCommands';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

/**
 * Modal for HAL-driven manual tool change (`machine.tool_change.requested`).
 * Overlay / Escape / X behave like cancel and send `machine.tool_change_abort`.
 */
export function ToolChangeDialogHost() {
  const { t } = useTranslation('components');
  const pending = useAppStore((s) => s.pendingToolChange);
  const setPendingToolChange = useAppStore((s) => s.setPendingToolChange);
  const sendCommand = useSendCommand();
  /**
   * Radix Dialog often calls `onOpenChange(false)` synchron when `open` becomes false.
   * After OK we only send `tool_change_ack` and close; without this flag the same dismiss
   * sequence would incorrectly emit `tool_change_abort`. `queueMicrotask` clears the flag
   * if Radix never calls `onOpenChange` (no stuck suppress).
   */
  const suppressNextDismissAbortRef = useRef(false);

  const open = pending !== null;

  const closeWithAbort = () => {
    if (suppressNextDismissAbortRef.current) {
      suppressNextDismissAbortRef.current = false;
      return;
    }
    const p = useAppStore.getState().pendingToolChange;
    if (p !== null) {
      sendCommand('machine', 'tool_change_abort', {});
    }
    setPendingToolChange(null);
  };

  const handleAck = () => {
    suppressNextDismissAbortRef.current = true;
    sendCommand('machine', 'tool_change_ack', {});
    setPendingToolChange(null);
    queueMicrotask(() => {
      if (suppressNextDismissAbortRef.current) {
        suppressNextDismissAbortRef.current = false;
      }
    });
  };

  const toolNo = pending?.toolNumber ?? 0;
  const desc = (pending?.description ?? '').trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closeWithAbort();
        }
      }}
    >
      <DialogContent className="max-w-lg" data-e2e="tool-change-dialog">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">{t('toolChange.title')}</h2>
          <button
            type="button"
            aria-label={t('toolChange.closeAria')}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
            onClick={closeWithAbort}
          >
            ✕
          </button>
        </div>
        <p className="text-base text-foreground/90 mb-2">
          <Trans
            ns="components"
            i18nKey="toolChange.body"
            values={{ toolNo }}
            components={{
              bold: <span className="font-semibold tabular-nums" />,
            }}
          />
        </p>
        {desc ? (
          <p className="text-sm text-muted-foreground mb-6 border-l-2 border-primary/40 pl-3">{desc}</p>
        ) : (
          <div className="mb-6" />
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={closeWithAbort}>
            {t('toolChange.cancel')}
          </Button>
          <Button type="button" onClick={handleAck}>
            {t('toolChange.ack')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
