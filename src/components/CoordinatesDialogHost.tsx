import { useEffect, useState } from 'react';

import type { CoordinateAxisKey } from '@/api/coordinateSystems';
import { CoordinateSystemsDialog } from '@/components/CoordinateSystemsDialog';
import { eventBus } from '@/eventBus';

export function CoordinatesDialogHost() {
  const [open, setOpen] = useState(false);
  const [openAxis, setOpenAxis] = useState<CoordinateAxisKey | null>(null);
  const [openAxisRequestId, setOpenAxisRequestId] = useState<number>(0);

  useEffect(() => {
    const unsubscribeOpen = eventBus.subscribe('ui.coordinates.openDialog', () => {
      setOpenAxis(null);
      setOpen(true);
    });

    const unsubscribeOpenAxis = eventBus.subscribe('ui.coordinates.openAxisDialog', ({ axis }) => {
      setOpenAxis(axis);
      setOpenAxisRequestId((prev) => prev + 1);
      setOpen(true);
    });

    return () => {
      unsubscribeOpen();
      unsubscribeOpenAxis();
    };
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setOpenAxis(null);
  };

  return (
    <CoordinateSystemsDialog
      open={open}
      onOpenChange={handleOpenChange}
      openAxis={openAxis}
      openAxisRequestId={openAxisRequestId}
    />
  );
}
