import { useEffect } from 'react';
import { eventBus } from '@/eventBus';
import { useHomingCommands } from '@/hooks/useHomingCommands';

export function HomingEventListener() {
  const { handleHoming } = useHomingCommands();

  useEffect(() => {
    const unsubscribe = eventBus.subscribe('ui.homing.select', ({ axis, action }) => {
      handleHoming(axis, action);
    });

    return () => {
      unsubscribe();
    };
  }, [handleHoming]);

  return null;
}

