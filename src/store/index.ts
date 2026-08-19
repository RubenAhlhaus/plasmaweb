import { create } from 'zustand';
import type { BoundStore } from './types';
import { createUISlice } from './uiSlice';
import { createMachineSlice } from './machineSlice';
import { createPlasmaSlice } from './plasmaSlice';

export const useAppStore = create<BoundStore>()((...a) => ({
  ...createUISlice(...a),
  ...createMachineSlice(...a),
  ...createPlasmaSlice(...a),
}));

// `BoundStore` is consumed by typed store selectors (e.g. useHomingCommands, useJogPreconditions).
export type { BoundStore } from './types';
