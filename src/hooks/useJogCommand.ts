import { useCallback, useEffect } from 'react';
import { useAppStore } from '@/store';
import { useSendCommand } from '@/api/backendCommands';
import type { UiJogRequest } from '@/api/jogTypes';
import { eventBus } from '@/eventBus';
import { allJointsHomed, isAxisHomed } from '@/utils/homing';
import {
  axisNeedsSynchronisedHoming,
  jointCoordinatesFromIni,
  primaryJointIndexForAxis,
} from '@/lib/axisJointMap';

/** Axis index for axis-mode jogging (`JOGGING_AXIS`), which is addressed by letter. */
const AXIS_INDEX: Record<UiJogRequest['axis'], number> = {
  x: 0,
  y: 1,
  z: 2,
};

type JogBlockReason =
  /** Axis is unhomed and the user has not confirmed joint-mode jogging yet. */
  | 'needs_confirmation'
  /** The machine has no such axis. */
  | 'unknown_axis'
  /**
   * Axis is unhomed and moves as a synchronised set (two joints, or a negative
   * HOME_SEQUENCE). Jogging one joint of a gantry would rack it, so joint-mode jogging is
   * refused outright — home first. QtPlasmaC keeps `all_homed` on these jog buttons.
   */
  | 'synchronised_axis_unhomed';

type JogRoutingResolution =
  | { blocked: true; reason: JogBlockReason }
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
  iniRuntimeConfig: ReturnType<typeof useAppStore.getState>['iniRuntimeConfig'],
): JogRoutingResolution {
  const jointCoordinates = jointCoordinatesFromIni(iniRuntimeConfig);
  const axisIsHomed = isAxisHomed(linuxCncStatus, axis, jointCoordinates);
  const synchronised = axisNeedsSynchronisedHoming(
    jointCoordinates,
    axis,
    iniRuntimeConfig.joint_home_sequences ?? [],
  );

  // Jogging by axis letter needs LinuxCNC's world (teleop) mode, which it only allows once
  // every joint is homed; the backend switches to it then. Until that point a homed axis
  // still jogs by joint index (only the same number on a plain XYZ machine). A homed gantry
  // axis is the exception: jogging one of its joints would rack it, so it is sent by axis
  // and the backend answers with which joints still need homing.
  if (axisIsHomed && (synchronised || allJointsHomed(linuxCncStatus, jointCoordinates))) {
    return { blocked: false, index: AXIS_INDEX[axis], jointMode: false, axisIsHomed };
  }

  const joint = primaryJointIndexForAxis(jointCoordinates, axis);
  if (joint === null) {
    return { blocked: true, reason: 'unknown_axis' };
  }
  if (axisIsHomed) {
    return { blocked: false, index: joint, jointMode: true, axisIsHomed };
  }
  if (synchronised) {
    return { blocked: true, reason: 'synchronised_axis_unhomed' };
  }
  if (!shownUnhomedJogDialogAxes[axis]) {
    return { blocked: true, reason: 'needs_confirmation' };
  }

  return { blocked: false, index: joint, jointMode: true, axisIsHomed };
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
      const { iniRuntimeConfig } = useAppStore.getState();
      const routing = resolveJogRouting(
        request.axis,
        linuxCncStatus,
        shownUnhomedJogDialogAxes,
        iniRuntimeConfig,
      );
      if (routing.blocked) {
        if (routing.reason === 'needs_confirmation') {
          eventBus.publish('ui.unhomed_jog.confirm', request);
        }
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
      const { jogMode, linuxCncStatus, shownUnhomedJogDialogAxes, iniRuntimeConfig } =
        useAppStore.getState();
      if (jogMode !== 'continuous') {
        return;
      }

      const routing = resolveJogRouting(
        request.axis,
        linuxCncStatus,
        shownUnhomedJogDialogAxes,
        iniRuntimeConfig,
      );
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
