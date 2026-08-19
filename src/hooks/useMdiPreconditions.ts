import { useAppStore } from '@/store';
import i18n from '@/i18n/config';
import { InterpState, TaskMode, TaskState } from '@/store/types';

export type MdiDisabledReasonKey =
  | 'estop_active'
  | 'machine_off'
  | 'interpreter_busy'
  | 'task_mode_unknown'
  | 'task_mode_not_manual_or_mdi';

interface MdiPreconditions {
  canMdi: boolean;
  reasons: MdiDisabledReasonKey[];
}

function mt(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'hooks', ...opts });
}

function evaluateMdiPreconditions(input: {
  taskState: TaskState | undefined;
  hardwareEstop: boolean;
  interpState: InterpState | undefined;
  taskMode: TaskMode | undefined;
}): MdiPreconditions {
  const reasons: MdiDisabledReasonKey[] = [];
  const { taskState, hardwareEstop, interpState, taskMode } = input;

  if (taskState === TaskState.STATE_ESTOP || hardwareEstop) {
    reasons.push('estop_active');
  } else if (taskState !== TaskState.STATE_ON) {
    reasons.push('machine_off');
  }

  if (interpState !== undefined && interpState !== InterpState.INTERP_IDLE) {
    reasons.push('interpreter_busy');
  }

  if (taskState === TaskState.STATE_ON) {
    if (taskMode === undefined) {
      reasons.push('task_mode_unknown');
    } else if (taskMode !== TaskMode.MODE_MANUAL && taskMode !== TaskMode.MODE_MDI) {
      reasons.push('task_mode_not_manual_or_mdi');
    }
  }

  return {
    canMdi: reasons.length === 0,
    reasons,
  };
}

function getMdiDisabledTooltip(reason: MdiDisabledReasonKey): string {
  const k = `mdi.tooltip.${reason}`;
  const tr = mt(k);
  return tr !== k ? tr : mt('mdi.tooltip.default');
}

function getCombinedMdiDisabledTooltip(reasons: MdiDisabledReasonKey[]): string | null {
  if (!reasons.length) return null;
  const uniqueReasons = Array.from(new Set(reasons));
  return uniqueReasons.map((reason) => getMdiDisabledTooltip(reason)).join(' | ');
}

function reasonHintFragment(reason: MdiDisabledReasonKey): string {
  const k = `mdi.hintFragment.${reason}`;
  const tr = mt(k);
  return tr !== k ? tr : mt('mdi.hintFragment.default');
}

/** Short hints for users without MDI jargon (spindle/feed dialog). */
export function getFriendlyCantSetNumericValueMessage(
  reasons: MdiDisabledReasonKey[],
  kind: 'spindle' | 'feed',
): string | null {
  if (!reasons.length) return null;
  const what = kind === 'spindle' ? mt('mdi.friendly.spindle') : mt('mdi.friendly.feed');
  const unique = Array.from(new Set(reasons));

  if (unique.length === 1) {
    const r = unique[0];
    const msgKey = `mdi.friendly.${r}`;
    const msg = mt(msgKey, { what });
    if (msg !== msgKey) return msg;
    return mt('mdi.friendly.default', { what });
  }

  const fragments = unique.map(reasonHintFragment);
  return mt('mdi.friendly.multi', { what, reasons: fragments.join(' · ') });
}

export function useMdiPreconditions() {
  const taskState = useAppStore((s) => s.linuxCncStatus.machine.task_state);
  const taskMode = useAppStore((s) => s.linuxCncStatus.machine.task_mode);
  const hardwareEstop = useAppStore((s) => s.linuxCncStatus.machine.error === true);
  const interpState = useAppStore((s) => s.linuxCncStatus.program.interp_state);

  const { canMdi, reasons } = evaluateMdiPreconditions({
    taskState,
    hardwareEstop,
    interpState,
    taskMode,
  });

  return {
    canMdi,
    reasons,
    tooltip: getCombinedMdiDisabledTooltip(reasons),
  };
}
