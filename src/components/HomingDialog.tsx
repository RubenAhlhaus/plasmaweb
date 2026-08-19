import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomingAction, HomingAxis, HomingSelectHandler } from '@/api/homingTypes';
import { eventBus } from '@/eventBus';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export function HomingDialog() {
  const { t } = useTranslation('components');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe('ui.homing.openDialog', () => {
      setOpen(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSelect = (axis: HomingAxis, action: HomingAction = 'home') => {
    eventBus.publish('ui.homing.select', { axis, action });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">{t('homing.title')}</h2>
          <button
            type="button"
            aria-label={t('homing.closeAria')}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-5 gap-4">
          <HomingActionButton labelKey="homing.homeAll" axis="all" onSelect={handleSelect} />
          <HomingActionButton labelKey="homing.homeX" axis="x" onSelect={handleSelect} />
          <HomingActionButton labelKey="homing.homeY" axis="y" onSelect={handleSelect} />
          <HomingActionButton labelKey="homing.homeZ" axis="z" onSelect={handleSelect} />
          <UnhomeAllButton onSelect={handleSelect} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type HomingActionButtonProps = {
  labelKey: `homing.${'homeAll' | 'homeX' | 'homeY' | 'homeZ'}`;
  axis: HomingAxis;
  onSelect: HomingSelectHandler;
};

function HomingActionButton({ labelKey, axis, onSelect }: HomingActionButtonProps) {
  const { t } = useTranslation('components');
  const iconLetter = axis === 'all' ? 'A' : axis.toUpperCase();

  return (
    <Button
      type="button"
      data-e2e={`homing-home-${axis}`}
      variant="outline"
      className="h-48 min-w-0 flex flex-col items-center justify-center gap-3 px-2 font-semibold"
      onClick={() => onSelect(axis, 'home')}
    >
      <div className="flex shrink-0 items-center justify-center w-20 h-20 rounded-full bg-primary/10 text-primary text-3xl font-bold">
        {iconLetter}
      </div>
      <div className="mt-1 w-full text-center text-sm leading-snug break-words">{t(labelKey)}</div>
    </Button>
  );
}

type UnhomeAllButtonProps = {
  onSelect: HomingSelectHandler;
};

function UnhomeAllButton({ onSelect }: UnhomeAllButtonProps) {
  const { t } = useTranslation('components');
  return (
    <Button
      type="button"
      data-e2e="homing-unhome-all"
      variant="outline"
      className="h-48 min-w-0 flex flex-col items-center justify-center gap-3 px-2 font-semibold"
      onClick={() => onSelect('all', 'unhome')}
    >
      <div className="flex shrink-0 items-center justify-center w-20 h-20 rounded-full bg-primary/10 text-primary text-3xl font-bold">
        U
      </div>
      <div className="mt-1 w-full text-center text-sm leading-snug break-words">{t('homing.unhomeAll')}</div>
    </Button>
  );
}

