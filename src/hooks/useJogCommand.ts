import { useCallback, useEffect } from 'react';
import { useAppStore } from '@/store';
import { useSendCommand } from '@/api/backendCommands';
import type { UiJogRequest } from '@/api/jogTypes';
import { eventBus } from '@/eventBus';
import { isAxisHomed } from '@/utils/homing';

const AXIS_INDEX: Record<UiJogRequest['axis'], number> = {
  x: 0,
  y: 1,
  z: 2,
};

type JogRoutingResolution =
  | { blocked: true }
  | {
      blocked: false;
      index: number;
      jointMode: boolean;
      axisIsHomed: boolean;
    };

function resolveJogRouting(
  axis: UiJogRequest['axis'],
  linuxCncStatus: ReturnType<typeof useAppStore.getState>['linuxCncStatus'],
  shownUnhomedJogDialogAxes: ReturnType<typeof useAppStore.getState>['shownUnhomedJogDialogAxes'],
): JogRoutingResolution {
  const index = AXIS_INDEX[axis];
  const axisIsHomed = isAxisHomed(linuxCncStatus, axis);
  const dialogShownForAxis = !!shownUnhomedJogDialogAxes[axis];
  if (!axisIsHomed && !dialogShownForAxis) {
    return { blocked: true };
  }

  return {
    blocked: false,
    index,
    jointMode: !axisIsHomed,
    axisIsHomed,
  };
}

export function useJogCommand() {
  const sendCommand = useSendCommand();

  const handleJog = useCallback(
    (request: UiJogRequest) => {
      const {
        jogMode,
        selectedJogIncrement,
        jogVelocityMmPerMin,
        linuxCncStatus,
        shownUnhomedJogDialogAxes,
      } = useAppStore.getState();
      const routing = resolveJogRouting(request.axis, linuxCncStatus, shownUnhomedJogDialogAxes);
      if (routing.blocked) {
        eventBus.publish('ui.unhomed_jog.confirm', request);
        return;
      }

      const mode = jogMode === 'continuous' ? 'continuous' : 'increment';
      const baseVelocity = jogVelocityMmPerMin;
      const velocity = request.direction === 'positive' ? baseVelocity : -baseVelocity;

      const params: {
        jointMode: boolean;
        index: number;
        velocity: number;
        mode: 'continuous' | 'increment';
        distance?: number;
      } = {
        jointMode: routing.jointMode,
        index: routing.index,
        velocity,
        mode,
      };

      if (mode === 'increment') {
        params.distance = selectedJogIncrement;
      }

      sendCommand('motion', 'jog', params);
    },
    [sendCommand],
  );

  return handleJog;
}

export function useJogStopCommand() {
  const sendCommand = useSendCommand();

  const handleJogStop = useCallback(
    (request: Pick<UiJogRequest, 'axis'>) => {
      const { jogMode, linuxCncStatus, shownUnhomedJogDialogAxes } = useAppStore.getState();
      if (jogMode !== 'continuous') {
        return;
      }

      const routing = resolveJogRouting(request.axis, linuxCncStatus, shownUnhomedJogDialogAxes);
      if (routing.blocked) {
        return;
      }

      sendCommand('motion', 'jog_stop', {
        jointMode: routing.jointMode,
        index: routing.index,
      });
    },
    [sendCommand],
  );

  return handleJogStop;
}

export function useJogEventSubscription() {
  const handleJog = useJogCommand();
  const handleJogStop = useJogStopCommand();

  useEffect(() => {
    const unsubscribeCommand = eventBus.subscribe('jog.move', (payload: UiJogRequest) => {
      handleJog(payload);
    });
    const unsubscribeStop = eventBus.subscribe('jog.stop', (payload: Pick<UiJogRequest, 'axis'>) => {
      handleJogStop(payload);
    });

    return () => {
      unsubscribeCommand();
      unsubscribeStop();
    };
  }, [handleJog, handleJogStop]);
}
