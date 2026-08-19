import { useEffect } from 'react';

import { eventBus } from '@/eventBus';
import {
  findOverridePositionForHotkey,
  overridePercentForPosition,
} from '@/lib/overridePresetHotkeys';
import {
  findButtonIdForHotkey,
  hotkeyFromKeyboardEvent,
  shouldIgnoreGlobalHotkeyTarget,
} from '@/lib/virtualSidebarHotkeys';
import { useAppStore } from '@/store';
import { useVirtualSidebarActions } from './useVirtualSidebarActions';

/**
 * Listens for configured virtual-sidebar and override-preset hotkeys
 * and triggers the matching action.
 */
export function useGlobalHotkeyListener() {
  const virtualSidebarHotkeys = useAppStore((s) => s.virtualSidebarHotkeys);
  const feedOverrideHotkeys = useAppStore((s) => s.feedOverrideHotkeys);
  const spindleOverrideHotkeys = useAppStore((s) => s.spindleOverrideHotkeys);
  const { executeButton } = useVirtualSidebarActions();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (shouldIgnoreGlobalHotkeyTarget(event.target)) return;

      const hotkey = hotkeyFromKeyboardEvent(event);
      if (!hotkey) return;

      const buttonId = findButtonIdForHotkey(virtualSidebarHotkeys, hotkey);
      if (buttonId != null) {
        event.preventDefault();
        event.stopPropagation();
        executeButton(buttonId, 'hotkey');
        return;
      }

      const feedPosition = findOverridePositionForHotkey(feedOverrideHotkeys, hotkey);
      if (feedPosition != null) {
        event.preventDefault();
        event.stopPropagation();
        eventBus.publish('ui.feed.setOverride', {
          percent: overridePercentForPosition(feedPosition),
          source: 'hotkey',
        });
        return;
      }

      const spindlePosition = findOverridePositionForHotkey(spindleOverrideHotkeys, hotkey);
      if (spindlePosition != null) {
        event.preventDefault();
        event.stopPropagation();
        eventBus.publish('ui.spindle.setOverride', {
          percent: overridePercentForPosition(spindlePosition),
          source: 'hotkey',
        });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [
    virtualSidebarHotkeys,
    feedOverrideHotkeys,
    spindleOverrideHotkeys,
    executeButton,
  ]);
}
