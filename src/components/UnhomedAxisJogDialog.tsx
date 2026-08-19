import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UiJogRequest } from '@/api/jogTypes';
import { eventBus } from '@/eventBus';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';

type DialogPayload = UiJogRequest | null;

export function UnhomedAxisJogDialog() {
  const { t } = useTranslation('components');
  const [open, setOpen] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<DialogPayload>(null);

  const setUnhomedJogDialogShownForAxis = useAppStore(
    (s) => s.setUnhomedJogDialogShownForAxis,
  );

  useEffect(() => {
    const unsubscribe = eventBus.subscribe('ui.unhomed_jog.confirm', (payload) => {
      setPendingRequest(payload);
      setOpen(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleCancel = () => {
    setOpen(false);
    setPendingRequest(null);
  };

  const handleConfirm = () => {
    if (!pendingRequest) {
      setOpen(false);
      return;
    }

    setUnhomedJogDialogShownForAxis(pendingRequest.axis);

    eventBus.publish('jog.move', pendingRequest);

    setOpen(false);
    setPendingRequest(null);
  };

  const axisLabel =
    pendingRequest?.axis === 'x'
      ? 'X'
      : pendingRequest?.axis === 'y'
        ? 'Y'
        : pendingRequest?.axis === 'z'
          ? 'Z'
          : '';
  const axisSuffix = axisLabel ? ` (${axisLabel})` : '';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">{t('unhomedJog.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('unhomedJog.paragraph1', { suffix: axisSuffix })}
          </p>
          <p className="text-sm text-muted-foreground">{t('unhomedJog.paragraph2')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t('unhomedJog.cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm}>
            {t('unhomedJog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

