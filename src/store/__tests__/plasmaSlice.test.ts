import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/store';

describe('plasmaSlice', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
  });

  it('starts unavailable so non-plasma machines never show plasma UI', () => {
    const state = useAppStore.getState();
    expect(state.plasmaAvailable).toBe(false);
    expect(state.plasmaPins).toEqual({ plasmac: {}, qtplasmac: {} });
    expect(state.plasmaState.stateName).toBeNull();
    expect(state.plasmaMissingPins).toEqual([]);
  });

  it('marks the layer available and stores the full snapshot', () => {
    useAppStore.getState().setPlasmaSnapshot({
      pins: { plasmac: { 'torch-on': false, 'arc-voltage-out': 12.5 }, qtplasmac: { 'laser-on': true } },
      state: {
        state: 11,
        stateName: 'CUT_MODE_01',
        stateDescription: 'cutting in either mode 0 or mode 1',
        stopType: 0,
        stopTypeName: 'NONE',
        isCutting: true,
      },
      missingPins: ['plasmac.dry-run'],
    });

    const state = useAppStore.getState();
    expect(state.plasmaAvailable).toBe(true);
    expect(state.plasmaPins.plasmac['arc-voltage-out']).toBe(12.5);
    expect(state.plasmaPins.qtplasmac['laser-on']).toBe(true);
    expect(state.plasmaState.stateName).toBe('CUT_MODE_01');
    expect(state.plasmaMissingPins).toEqual(['plasmac.dry-run']);
  });

  it('merges diffs without dropping pins that did not change', () => {
    useAppStore.getState().setPlasmaSnapshot({
      pins: { plasmac: { 'torch-on': false, 'arc-voltage-out': 0 }, qtplasmac: {} },
    });

    useAppStore.getState().mergePlasmaPins({ plasmac: { 'torch-on': true } });

    const pins = useAppStore.getState().plasmaPins;
    expect(pins.plasmac['torch-on']).toBe(true);
    expect(pins.plasmac['arc-voltage-out']).toBe(0);
  });

  it('merges each component independently', () => {
    useAppStore.getState().setPlasmaSnapshot({
      pins: { plasmac: { 'torch-on': false }, qtplasmac: { 'ext-pause': false } },
    });

    useAppStore.getState().mergePlasmaPins({ qtplasmac: { 'ext-pause': true } });

    const pins = useAppStore.getState().plasmaPins;
    expect(pins.qtplasmac['ext-pause']).toBe(true);
    expect(pins.plasmac['torch-on']).toBe(false);
  });

  it('replaces the decoded state wholesale', () => {
    useAppStore.getState().setPlasmaState({
      state: 6,
      stateName: 'TORCH_ON',
      stateDescription: 'turn the torch on',
      stopType: null,
      stopTypeName: null,
      isCutting: true,
    });
    expect(useAppStore.getState().plasmaState.stateName).toBe('TORCH_ON');
  });

  it('resets everything when the socket drops, because pin values go stale', () => {
    useAppStore.getState().setPlasmaSnapshot({
      pins: { plasmac: { 'torch-on': true } },
      missingPins: ['plasmac.dry-run'],
    });

    useAppStore.getState().resetPlasma();

    const state = useAppStore.getState();
    expect(state.plasmaAvailable).toBe(false);
    expect(state.plasmaPins.plasmac).toEqual({});
    expect(state.plasmaMissingPins).toEqual([]);
  });
});
