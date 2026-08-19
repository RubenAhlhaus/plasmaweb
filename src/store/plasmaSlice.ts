import type { StateCreator } from 'zustand';
import type { BoundStore, PlasmaPinValues, PlasmaSlice, PlasmaState } from './types';

export const initialPlasmaState: PlasmaState = {
  state: null,
  stateName: null,
  stateDescription: null,
  stopType: null,
  stopTypeName: null,
  isCutting: false,
};

const emptyPins: PlasmaPinValues = { plasmac: {}, qtplasmac: {} };

/**
 * Live `plasmac.*` and `qtplasmac.*` pin values.
 *
 * The backend sends one full snapshot per connection and diffs afterwards, so this slice
 * only ever merges. `available` stays false on a machine without the plasma HAL layer
 * (or during development on macOS), which is what the UI keys off to hide plasma screens.
 */
export const createPlasmaSlice: StateCreator<BoundStore, [], [], PlasmaSlice> = (set) => ({
  plasmaAvailable: false,
  plasmaPins: emptyPins,
  plasmaState: initialPlasmaState,
  plasmaMissingPins: [],

  setPlasmaSnapshot: (snapshot) =>
    set(() => ({
      plasmaAvailable: true,
      plasmaPins: {
        plasmac: { ...(snapshot.pins?.plasmac ?? {}) },
        qtplasmac: { ...(snapshot.pins?.qtplasmac ?? {}) },
      },
      plasmaState: snapshot.state ?? initialPlasmaState,
      plasmaMissingPins: snapshot.missingPins ?? [],
    })),

  mergePlasmaPins: (diff) =>
    set((prev) => ({
      plasmaPins: {
        plasmac: { ...prev.plasmaPins.plasmac, ...(diff.plasmac ?? {}) },
        qtplasmac: { ...prev.plasmaPins.qtplasmac, ...(diff.qtplasmac ?? {}) },
      },
    })),

  setPlasmaState: (state) => set(() => ({ plasmaState: state })),

  resetPlasma: () =>
    set(() => ({
      plasmaAvailable: false,
      plasmaPins: emptyPins,
      plasmaState: initialPlasmaState,
      plasmaMissingPins: [],
    })),
});
