import { eventBus, type VirtualSidebarLikeSource } from '@/eventBus';
import {
  halSoftkeyDisplaySlotForButton,
  VIRTUAL_SIDEBAR_ACTION_BUTTON_IDS,
} from '@/lib/virtualSidebarButtons';
import type { VirtualSidebarButtonId } from '@/lib/virtualSidebarHotkeys';

export type VirtualSidebarActionSource = VirtualSidebarLikeSource;

export function dispatchVirtualSidebarButton(
  buttonId: VirtualSidebarButtonId,
  source: VirtualSidebarActionSource,
): void {
  switch (buttonId) {
    case 1:
      eventBus.publish('ui.machine.toggle', { source });
      break;
    case 2:
      eventBus.publish('ui.homing.openDialog', { source });
      break;
    case 3:
      eventBus.publish('ui.program.cycleStart', { source });
      break;
    case 4:
      eventBus.publish('ui.estop.toggle', { source });
      break;
    case 5:
      eventBus.publish('ui.coordinates.openAxisDialog', { axis: 'x', source });
      break;
    case 6:
      eventBus.publish('ui.coordinates.openAxisDialog', { axis: 'y', source });
      break;
    case 7:
      eventBus.publish('ui.coordinates.openAxisDialog', { axis: 'z', source });
      break;
    case 9:
      eventBus.publish('ui.flood.toggle', { source });
      break;
    case 10:
      eventBus.publish('ui.spindle.direction', { direction: 'reverse', source });
      break;
    case 11:
      eventBus.publish('ui.spindle.direction', { direction: 'stop', source });
      break;
    case 12:
      eventBus.publish('ui.spindle.direction', { direction: 'forward', source });
      break;
    case 14:
      eventBus.publish('ui.program.pause', { source });
      break;
    case 15:
      eventBus.publish('ui.program.stop', { source });
      break;
    case 8:
    case 13:
    case 16:
      eventBus.publish('ui.hal.softkey', {
        slot: halSoftkeyDisplaySlotForButton(buttonId),
        source,
      });
      break;
    default:
      break;
  }
}

export function isVirtualSidebarButtonId(value: unknown): value is VirtualSidebarButtonId {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    VIRTUAL_SIDEBAR_ACTION_BUTTON_IDS.has(value as VirtualSidebarButtonId)
  );
}
