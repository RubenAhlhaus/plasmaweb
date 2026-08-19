import { describe, expect, it } from 'vitest';

import { eventBus } from '@/eventBus';
import { dispatchVirtualSidebarButton } from '@/lib/dispatchVirtualSidebarButton';

describe('dispatchVirtualSidebarButton', () => {
  it('publishes ui.homing.openDialog with hal source for button 2', () => {
    const received: Array<{ source: string }> = [];
    const unsub = eventBus.subscribe('ui.homing.openDialog', (payload) => {
      received.push(payload);
    });

    dispatchVirtualSidebarButton(2, 'hal');

    expect(received).toEqual([{ source: 'hal' }]);
    unsub();
  });

  it('publishes ui.coordinates.openAxisDialog for axis buttons', () => {
    const received: Array<{ axis: string; source: string }> = [];
    const unsub = eventBus.subscribe('ui.coordinates.openAxisDialog', (payload) => {
      received.push(payload);
    });

    dispatchVirtualSidebarButton(5, 'hal');
    dispatchVirtualSidebarButton(6, 'hal');

    expect(received).toEqual([
      { axis: 'x', source: 'hal' },
      { axis: 'y', source: 'hal' },
    ]);
    unsub();
  });
});
