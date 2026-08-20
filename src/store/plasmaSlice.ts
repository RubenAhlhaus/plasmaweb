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
  plasmaMaterials: null,
  plasmaParameters: null,
  plasmaToolpath: null,
  plasmaToolpathError: null,
  plasmaToolpathLoading: false,

  setPlasmaSnapshot: (snapshot) =>
    set((prev) => ({
      plasmaAvailable: true,
      plasmaPins: {
        plasmac: { ...(snapshot.pins?.plasmac ?? {}) },
        qtplasmac: { ...(snapshot.pins?.qtplasmac ?? {}) },
      },
      plasmaState: snapshot.state ?? initialPlasmaState,
      plasmaMissingPins: snapshot.missingPins ?? [],
      // A snapshot without them means no INI, not "forget what we know".
      plasmaMaterials: snapshot.materials ?? prev.plasmaMaterials,
      plasmaParameters: snapshot.parameters ?? prev.plasmaParameters,
    })),

  mergePlasmaPins: (diff) =>
    set((prev) => ({
      plasmaPins: {
        plasmac: { ...prev.plasmaPins.plasmac, ...(diff.plasmac ?? {}) },
        qtplasmac: { ...prev.plasmaPins.qtplasmac, ...(diff.qtplasmac ?? {}) },
      },
    })),

  setPlasmaState: (state) => set(() => ({ plasmaState: state })),

  setPlasmaMaterials: (materials) => set(() => ({ plasmaMaterials: materials })),

  setPlasmaParameters: (parameters) => set(() => ({ plasmaParameters: parameters })),

  setPlasmaToolpath: (toolpath) =>
    set(() => ({ plasmaToolpath: toolpath, plasmaToolpathError: null, plasmaToolpathLoading: false })),

  setPlasmaToolpathError: (message) =>
    set(() => ({ plasmaToolpathError: message, plasmaToolpathLoading: false })),

  setPlasmaToolpathLoading: (loading) => set(() => ({ plasmaToolpathLoading: loading })),

  resetPlasma: () =>
    set(() => ({
      plasmaAvailable: false,
      plasmaPins: emptyPins,
      plasmaState: initialPlasmaState,
      plasmaMissingPins: [],
      plasmaMaterials: null,
      plasmaParameters: null,
      plasmaToolpath: null,
      plasmaToolpathError: null,
      plasmaToolpathLoading: false,
    })),
});
