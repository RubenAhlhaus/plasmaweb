import { useAppStore, type BoundStore } from '@/store';
import i18n from '@/i18n/config';
import type { LinuxCncMachineStatus } from '@/store/types';
import { TaskMode, TaskState } from '@/store/types';

export type JogDisabledReasonKey = 'not_manual_mode' | 'machine_off' | 'estop_active';

export interface JogPreconditions {
  canJog: boolean;
  reasons: JogDisabledReasonKey[];
}

function mt(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'hooks', ...opts });
}

export function evaluateJogPreconditions(
  machine: LinuxCncMachineStatus | undefined | null,
): JogPreconditions {
  const reasons: JogDisabledReasonKey[] = [];

  const taskState = machine?.task_state;
  const taskMode = machine?.task_mode;

  if (taskState === TaskState.STATE_ESTOP || machine?.error === true) {
    reasons.push('estop_active');
  } else if (taskState !== TaskState.STATE_ON) {
    reasons.push('machine_off');
  }

  const isManualMode = taskMode === TaskMode.MODE_MANUAL;

  if (!isManualMode) {
    reasons.push('not_manual_mode');
  }

  const canJog = reasons.length === 0;

  return { canJog, reasons };
}

export function getJogDisabledTooltip(reason: JogDisabledReasonKey): string {
  const k = `jog.tooltip.${reason}`;
  const tr = mt(k);
  return tr !== k ? tr : mt('jog.tooltip.default');
}

export function getCombinedJogDisabledTooltip(reasons: JogDisabledReasonKey[]): string | null {
  if (!reasons.length) {
    return null;
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return uniqueReasons.map((r) => getJogDisabledTooltip(r)).join('\n');
}

export function useJogPreconditions() {
  const machine = useAppStore((state: BoundStore) => state.linuxCncStatus.machine);

  const { canJog, reasons } = evaluateJogPreconditions(machine);
  const primaryReason = reasons[0] ?? null;
  const tooltip = primaryReason ? getJogDisabledTooltip(primaryReason) : null;

  return {
    canJog,
    reasons,
    primaryReason,
    tooltip,
    getTooltipForReason: getJogDisabledTooltip,
    getCombinedTooltip: () => getCombinedJogDisabledTooltip(reasons),
  };
}
