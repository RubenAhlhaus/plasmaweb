import { describe, expect, it, vi, beforeEach } from 'vitest';
import { eventBus } from './eventBus';

describe('eventBus', () => {
  beforeEach(() => {
    // ensure handlers from previous tests do not leak
    // by publishing an event and relying on tests to unsubscribe explicitly
  });

  it('notifies all subscribers for an event with the payload', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsubscribe1 = eventBus.subscribe('jog.move', handler1);
    const unsubscribe2 = eventBus.subscribe('jog.move', handler2);

    const payload = { axis: 'x', direction: 'positive' } as const;
    eventBus.publish('jog.move', payload);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledWith(payload);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith(payload);

    unsubscribe1();
    unsubscribe2();
  });

  it('stops notifying a handler after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.subscribe('jog.move', handler);

    const payload1 = { axis: 'y', direction: 'negative' } as const;
    eventBus.publish('jog.move', payload1);

    unsubscribe();

    const payload2 = { axis: 'z', direction: 'positive' } as const;
    eventBus.publish('jog.move', payload2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload1);
  });
});

