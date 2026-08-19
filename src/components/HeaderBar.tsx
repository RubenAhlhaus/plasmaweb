import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { waitForWsCommandResult } from '@/lib/waitForWsCommandResult';
import { AppTooltip } from '@/components/AppTooltip';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AlertTriangle, Home, Power } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store';
import { TaskMode, TaskState } from '@/store/types';
import { eventBus } from '@/eventBus';
import { getUnhomedAxes } from '@/utils/homing';
import { isProgramFileExecuting } from '@/lib/programFileExecuting';
import { isProgramInterpreterPaused } from '@/utils/isProgramInterpreterPaused';
import { suppressUnhandledRejection } from '@/lib/suppressUnhandledRejection';

/** WebSocket wait for app.exit ACK (backend may abort + power off before ACK on shutdown). */
const APP_EXIT_TIMEOUT_MS = 8_000;
/** Abort (up to 10 s) + power-off wait (up to 3 s) + margin — see backend/shutdown.py */
const APP_EXIT_SHUTDOWN_TIMEOUT_MS = 40_000;

function taskModeWhenOn(
  mode: TaskMode | undefined,
  t: (key: string) => string,
): { label: string; title: string } {
  if (mode === undefined) {
    return {
      label: t('header.taskMode.fallback.label'),
      title: t('header.taskMode.fallback.title'),
    };
  }
  switch (mode) {
    case TaskMode.MODE_MANUAL:
      return {
        label: t('header.taskMode.manual.label'),
        title: t('header.taskMode.manual.title'),
      };
    case TaskMode.MODE_AUTO:
      return {
        label: t('header.taskMode.auto.label'),
        title: t('header.taskMode.auto.title'),
      };
    case TaskMode.MODE_MDI:
      return {
        label: t('header.taskMode.mdi.label'),
        title: t('header.taskMode.mdi.title'),
      };
    default:
      return {
        label: t('header.taskMode.fallback.label'),
        title: t('header.taskMode.fallback.title'),
      };
  }
}

/** Stable DOM attribute for E2E (`AppTooltip` does not set a native `title`). */
function taskModeDataAttr(mode: TaskMode | undefined): string {
  if (mode === undefined) return 'on';
  switch (mode) {
    case TaskMode.MODE_MANUAL:
      return 'manual';
    case TaskMode.MODE_AUTO:
      return 'auto';
    case TaskMode.MODE_MDI:
      return 'mdi';
    default:
      return 'on';
  }
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const date = now.toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <div className="text-foreground/80">{date}</div>
      <div className="absolute left-1/2 -translate-x-1/2 text-foreground font-medium">{time}</div>
    </>
  );
}

export function HeaderBar() {
  const { t } = useTranslation('common');
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const sendCommand = useSendCommand();
  const { taskState, taskMode, hardwareEstop, motionHomed, joints } = useAppStore(
    useShallow((s) => ({
      taskState: s.linuxCncStatus.machine.task_state,
      taskMode: s.linuxCncStatus.machine.task_mode,
      hardwareEstop: s.linuxCncStatus.machine.error === true,
      motionHomed: s.linuxCncStatus.motion.homed,
      joints: s.linuxCncStatus.joints,
    })),
  );
  const { programExecuting, programPaused } = useAppStore(
    useShallow((s) => ({
      programExecuting: isProgramFileExecuting(s.linuxCncStatus),
      programPaused: isProgramInterpreterPaused(s.linuxCncStatus),
    })),
  );
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitInProgress, setExitInProgress] = useState(false);

  const notausActive = taskState === TaskState.STATE_ESTOP || hardwareEstop;
  const machineOffLike =
    taskState === TaskState.STATE_ESTOP_RESET ||
    taskState === TaskState.STATE_OFF ||
    taskState === 0 ||
    taskState == null;
  const taskOnDisplay = taskState === TaskState.STATE_ON ? taskModeWhenOn(taskMode, (k) => t(k)) : null;
  const unhomedAxes = useMemo(
    () => getUnhomedAxes({ motion: { homed: motionHomed }, joints }),
    [motionHomed, joints],
  );
  const unhomedAxesLabel = unhomedAxes.map((axis) => axis.toUpperCase()).join(', ');
  const showUnhomedIndicator = connectionStatus === 'connected' && unhomedAxes.length > 0;

  const handleQuit = useCallback(async (options?: { shutdown?: boolean }) => {
    const ws = useAppStore.getState().backendWebSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showErrorToast({ message: t('header.errors.noConnection'), kind: 'disconnected' });
      return;
    }
    const commandId = generateCommandId();
    setExitInProgress(true);
    try {
      const resultPromise = waitForWsCommandResult(
        commandId,
        options?.shutdown === true ? APP_EXIT_SHUTDOWN_TIMEOUT_MS : APP_EXIT_TIMEOUT_MS,
      );
      sendCommand(
        'app',
        'exit',
        { shutdown: options?.shutdown === true },
        commandId,
      );
      const { ok, error } = await resultPromise;
      if (!ok) {
        const message =
          error?.code === 'shutdown_unavailable'
            ? t('header.errors.shutdownUnavailable')
            : (error?.message ?? t('header.errors.exitRejected'));
        showErrorToast({
          message,
          kind: error?.code ?? 'app_exit',
        });
        return;
      }
      setExitDialogOpen(false);
      window.close();
      window.setTimeout(() => {
        if (!window.closed) {
          showErrorToast({
            message: t('header.errors.backendStopped'),
            kind: 'app_exit_web',
            tone: 'info',
          });
        }
      }, 300);
    } catch (e) {
      const timedOut = e instanceof Error && e.message === 'timeout';
      showErrorToast({
        message: timedOut ? t('header.errors.exitTimeout') : t('header.errors.exitFailed'),
        kind: 'app_exit',
      });
    } finally {
      setExitInProgress(false);
    }
  }, [sendCommand, showErrorToast, t]);

  const handleQuitClick = useCallback((options?: { shutdown?: boolean }) => {
    suppressUnhandledRejection(handleQuit(options), 'header quit failed unexpectedly');
  }, [handleQuit]);

  const handleExitClick = useCallback(() => {
    setExitDialogOpen(true);
  }, []);

  return (
    <div className="h-8 flex items-center justify-between px-6 text-sm bg-slate-950 border-b-2 border-slate-600/80 shadow-[0_4px_12px_rgba(0,0,0,0.4)] relative">
      <HeaderClock />
      <div className="flex items-center gap-3">
        {notausActive && (
          <AppTooltip content={t('header.estopActiveTooltip')}>
            <span
              className="flex items-center gap-1 text-red-500 font-semibold"
              data-e2e="header-estop-active"
            >
              <AlertTriangle className="h-5 w-5" />
              {t('header.estopActive')}
            </span>
          </AppTooltip>
        )}
        {!notausActive && machineOffLike && (
            <AppTooltip content={t('header.machineOffTooltip')}>
              <span
                className="flex items-center gap-1 text-amber-400 font-semibold"
                data-e2e="header-machine-off"
              >
                <AlertTriangle className="h-5 w-5" />
                {t('header.machineOff')}
              </span>
            </AppTooltip>
          )}
        {showUnhomedIndicator && (
          <AppTooltip content={t('header.unhomedAxes.tooltip')}>
            <button
              type="button"
              className="flex items-center gap-1 text-orange-400 font-semibold hover:text-orange-300 transition-colors"
              data-e2e="header-unhomed-axes"
              aria-label={t('header.unhomedAxes.openHomingAria', { axes: unhomedAxesLabel })}
              onClick={() => eventBus.publish('ui.homing.openDialog', { source: 'header' })}
            >
              <Home className="h-5 w-5" />
              {t('header.unhomedAxes.label', { axes: unhomedAxesLabel })}
            </button>
          </AppTooltip>
        )}
        {taskOnDisplay && (
          <AppTooltip content={taskOnDisplay.title}>
            <span
              className="text-emerald-400 font-semibold"
              data-e2e="header-task-mode-on"
              data-task-mode={taskModeDataAttr(taskMode)}
            >
              {taskOnDisplay.label}
            </span>
          </AppTooltip>
        )}
        {programExecuting && (
          <AppTooltip
            content={
              programPaused ? t('header.programPaused.title') : t('header.programRunning.title')
            }
          >
            <span
              className={
                programPaused ? 'text-amber-300 font-semibold' : 'text-sky-400 font-semibold'
              }
              data-e2e={programPaused ? 'header-program-paused' : 'header-program-running'}
              role="status"
            >
              {programPaused
                ? t('header.programPaused.label')
                : t('header.programRunning.label')}
            </span>
          </AppTooltip>
        )}
        {connectionStatus === 'disconnected' && (
          <AppTooltip content={t('header.disconnectedTooltip')}>
            <span className="flex items-center gap-1 text-slate-400 font-semibold">
              <AlertTriangle className="h-5 w-5" />
              {t('header.disconnected')}
            </span>
          </AppTooltip>
        )}
        <AppTooltip content={t('header.exit')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-foreground/80 hover:text-foreground"
            disabled={exitInProgress}
            data-e2e="header-exit-open"
            onClick={handleExitClick}
            aria-label={t('header.exitAria')}
          >
            <Power className="h-5 w-5" />
          </Button>
        </AppTooltip>
      </div>

      <Dialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <DialogContent
          title={t('header.exitDialogTitle')}
          className="max-w-xl p-8 [&_#dialog-title]:text-2xl [&_#dialog-title]:mb-8"
        >
          <div className="flex flex-col gap-6">
            <Button
              type="button"
              variant="default"
              className="h-auto min-h-24 w-full touch-manipulation whitespace-normal rounded-lg px-8 py-6 text-xl font-semibold leading-snug"
              disabled={exitInProgress}
              data-e2e="header-exit-close-window"
              onClick={() => handleQuitClick()}
            >
              {t('header.closeWindow')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-auto min-h-24 w-full touch-manipulation whitespace-normal rounded-lg px-8 py-6 text-xl font-semibold leading-snug"
              disabled={exitInProgress}
              data-e2e="header-exit-close-window-shutdown"
              onClick={() => handleQuitClick({ shutdown: true })}
            >
              {t('header.closeWindowShutdown')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-20 w-full touch-manipulation rounded-lg px-8 py-5 text-lg font-medium"
              disabled={exitInProgress}
              data-e2e="header-exit-cancel"
              onClick={() => setExitDialogOpen(false)}
            >
              {t('header.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
