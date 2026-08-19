import { useCallback } from 'react';

import {
  dispatchVirtualSidebarButton,
  type VirtualSidebarActionSource,
} from '@/lib/dispatchVirtualSidebarButton';
import type { VirtualSidebarButtonId } from '@/lib/virtualSidebarHotkeys';

export type { VirtualSidebarActionSource };

export function useVirtualSidebarActions() {
  const executeButton = useCallback(
    (buttonId: VirtualSidebarButtonId, source: VirtualSidebarActionSource) => {
      dispatchVirtualSidebarButton(buttonId, source);
    },
    [],
  );

  return { executeButton };
}
