import { create } from 'zustand';
import type { BoundStore } from './types';
import { createUISlice } from './uiSlice';
import { createMachineSlice } from './machineSlice';

export const useAppStore = create<BoundStore>()((...a) => ({
  ...createUISlice(...a),
  ...createMachineSlice(...a),
}));

// `BoundStore` is consumed by typed store selectors (e.g. useHomingCommands, useJogPreconditions).
export type { BoundStore } from './types';
