import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { useVirtualSidebarActions } from '@/hooks/useVirtualSidebarActions';
import {
  dataE2eForVirtualSidebarButton,
  getVirtualSidebarButtonLabel,
  isHalSoftkeyActive,
  VIRTUAL_SIDEBAR_ACTION_BUTTON_IDS,
  VIRTUAL_SIDEBAR_BUTTON_ORDER,
} from '@/lib/virtualSidebarButtons';
import type { VirtualSidebarButtonId } from '@/lib/virtualSidebarHotkeys';
import { usePlasmaScreenFormat } from '@/hooks/usePlasmaScreenFormat';
import { useAppStore } from '@/store';
import type { LinuxCncStatusRoot } from '@/store/types';
import { TaskState } from '@/store/types';
import { isProgramInterpreterPaused } from '@/utils/isProgramInterpreterPaused';

export function VirtualButtonSidebar() {
  const { t } = useTranslation('components');
  const { executeButton } = useVirtualSidebarActions();
  const {
    taskState,
    hardwareEstop,
    floodOn,
    spindleDirection,
    spindleEnabled,
    spindleSpeed,
    programPaused,
    halSoftkey14Active,
    halSoftkey15Active,
    halSoftkey16Active,
  } = useAppStore(
    useShallow((s) => {
      const spindle0 = s.linuxCncStatus.spindle[0] ?? {};
      const halSoftkeys = s.linuxCncStatus.io.hal_softkeys;
      const programSlice = {
        program: {
          paused: s.linuxCncStatus.program.paused,
          interp_state: s.linuxCncStatus.program.interp_state,
        },
      } as LinuxCncStatusRoot;
      return {
        taskState: s.linuxCncStatus.machine.task_state,
        hardwareEstop: s.linuxCncStatus.machine.error === true,
        floodOn: (s.linuxCncStatus.io.flood ?? 0) !== 0,
        spindleDirection: spindle0.direction ?? 0,
        spindleEnabled: spindle0.enabled ?? 0,
        spindleSpeed: spindle0.speed ?? 0,
        programPaused: isProgramInterpreterPaused(programSlice),
        halSoftkey14Active: isHalSoftkeyActive(halSoftkeys, 8),
        halSoftkey15Active: isHalSoftkeyActive(halSoftkeys, 13),
        halSoftkey16Active: isHalSoftkeyActive(halSoftkeys, 16),
      };
    }),
  );
  const estopActive = taskState === TaskState.STATE_ESTOP || hardwareEstop;
  const machineOn = taskState === TaskState.STATE_ON;
  const spindleLeftActive = spindleDirection < 0;
  const spindleRightActive = spindleDirection > 0;
  const spindleStopActive =
    (!spindleLeftActive && !spindleRightActive) || spindleEnabled === 0 || Math.abs(spindleSpeed) < 0.001;

  const activeStateByButton: Record<number, boolean> = {
    1: machineOn,
    4: estopActive,
    14: programPaused,
    9: floodOn,
    10: spindleLeftActive,
    11: spindleStopActive,
    12: spindleRightActive,
    8: halSoftkey14Active,
    13: halSoftkey15Active,
    16: halSoftkey16Active,
  };

  const activeClassForButton = (num: number) => {
    if (!activeStateByButton[num]) return '';
    // Estop keeps the machine's estop colour; everything else takes its highlight, so the
    // sidebar follows the same theme as the rest of the screen.
    if (num === 4) return '!bg-destructive !text-destructive-foreground !border-destructive';
    return '!bg-primary !text-primary-foreground !border-primary';
  };

  const format = usePlasmaScreenFormat();

  const buttonLabel = (num: VirtualSidebarButtonId) =>
    getVirtualSidebarButtonLabel(num, t, 'virtualSidebar.');

  return (
    <div className="h-full w-full flex flex-col items-stretch justify-start py-1 px-0 gap-0 surface-subtle border-r border-border/60 bg-background/40">
      {VIRTUAL_SIDEBAR_BUTTON_ORDER.map((num) => (
        <Button
          key={num}
          variant="surface"
          // The labels are words, not icons, so a narrower sidebar needs smaller type rather
          // than a smaller button: "Flood coolant" clipped to "ood coolant" helps nobody.
          className={`w-full ${format === 'wide' ? 'h-[110px] text-xs' : 'h-[86px] text-[0.6rem]'} whitespace-normal break-words font-semibold leading-tight px-1 ${activeClassForButton(num)}`}
          data-e2e={dataE2eForVirtualSidebarButton(num)}
          data-active={activeStateByButton[num] ? 'true' : 'false'}
          disabled={num === 9 && !machineOn}
          onClick={
            VIRTUAL_SIDEBAR_ACTION_BUTTON_IDS.has(num)
              ? () => executeButton(num, 'virtualSidebar')
              : undefined
          }
        >
          {num === 1 ? (
            <span className="flex flex-col leading-tight">
              <span>{t('virtualSidebar.machineLine1')}</span>
              <span>{t('virtualSidebar.machineLine2')}</span>
            </span>
          ) : (
            buttonLabel(num)
          )}
        </Button>
      ))}
    </div>
  );
}
