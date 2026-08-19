import { useAppStore } from '@/store';

type EventHandler<Payload> = (payload: Payload) => void;

/** Entry points that mirror virtual sidebar softkeys (click, keyboard shortcut, or HAL panel). */
export type VirtualSidebarLikeSource = 'virtualSidebar' | 'hotkey' | 'hal';

/** Cycle start/pause/stop also have on-screen buttons on the plasma MAIN screen. */
export type ProgramControlSource = VirtualSidebarLikeSource | 'plasmaScreen';

type FrontendEventMap = {
  'jog.move': {
    axis: 'x' | 'y' | 'z';
    direction: 'positive' | 'negative';
  };
  'jog.stop': {
    axis: 'x' | 'y' | 'z';
  };
  'ui.unhomed_jog.confirm': {
    axis: 'x' | 'y' | 'z';
    direction: 'positive' | 'negative';
  };
  'ui.homing.openDialog': {
    source: VirtualSidebarLikeSource | 'header';
  };
  'ui.homing.select': {
    action: 'home' | 'unhome';
    axis: 'all' | 'x' | 'y' | 'z';
  };
  'ui.machine.toggle': {
    source: VirtualSidebarLikeSource | 'header';
  };
  'ui.estop.toggle': {
    source: VirtualSidebarLikeSource;
  };
  'ui.flood.toggle': {
    source: VirtualSidebarLikeSource;
  };
  'ui.spindle.direction': {
    direction: 'forward' | 'reverse' | 'stop';
    source: VirtualSidebarLikeSource;
  };
  'ui.coordinates.openDialog': {
    source: 'coordinatesDisplay';
  };
  'ui.coordinates.openAxisDialog': {
    axis: 'x' | 'y' | 'z';
    source: VirtualSidebarLikeSource;
  };
  'ui.spindle.openDialog': {
    source: 'sliderControl';
  };
  'ui.feed.openDialog': {
    source: 'sliderControl';
  };
  'ui.feed.setOverride': {
    percent: number;
    source: 'hotkey';
  };
  'ui.spindle.setOverride': {
    percent: number;
    source: 'hotkey';
  };
  'ui.hal.softkey': {
    slot: 14 | 15 | 16;
    source: VirtualSidebarLikeSource;
  };
  'ui.program.pause': {
    source: ProgramControlSource;
  };
  'ui.program.stop': {
    source: ProgramControlSource;
  };
  'ui.program.cycleStart': {
    source: ProgramControlSource;
  };
  'ui.macros.generateProgram': {
    source: 'macrosScreen';
  };
};

type EventName = keyof FrontendEventMap;

type HandlerMap = {
  [K in EventName]?: Set<EventHandler<FrontendEventMap[K]>>;
};

class EventBus {
  private handlers: HandlerMap = {};

  publish<K extends EventName>(eventName: K, payload: FrontendEventMap[K]): void {
    const { debugLoggingEnabled, debugLogEventBus } = useAppStore.getState();
    if (debugLoggingEnabled && debugLogEventBus) {
      const timestamp = new Date().toISOString();
      // eslint-disable-next-line no-console
      console.log('[debug][eventbus]', timestamp, eventName, payload);
    }

    const listeners = this.handlers[eventName];
    if (!listeners || listeners.size === 0) return;

    for (const handler of listeners) {
      try {
        handler(payload);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Error in listener for event "${String(eventName)}"`, error);
      }
    }
  }

  subscribe<K extends EventName>(eventName: K, handler: EventHandler<FrontendEventMap[K]>): () => void {
    // Reads/writes by generic K are typed as an intersection of all events; assert per-key types.
    let listeners: Set<EventHandler<FrontendEventMap[K]>> | undefined =
      this.handlers[eventName] as Set<EventHandler<FrontendEventMap[K]>> | undefined;
    if (!listeners) {
      listeners = new Set();
      this.handlers[eventName] = listeners as HandlerMap[K];
    }

    listeners.add(handler);

    return () => {
      listeners?.delete(handler);
    };
  }
}

export const eventBus = new EventBus();
