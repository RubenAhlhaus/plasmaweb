import { useAppStore } from '@/store';
import type { PlasmaPinValue } from '@/store/types';

/**
 * Read one live pin value.
 *
 * Pins are addressed by their dashed HAL name without the component prefix, exactly as the
 * backend sends them (`torch-on`, not `plasmac.torch-on`). A pin this LinuxCNC build does
 * not have simply never appears, so callers get `undefined` and can render a dash instead
 * of a wrong zero.
 */
export function usePlasmacPin(name: string): PlasmaPinValue | undefined {
  return useAppStore((s) => s.plasmaPins.plasmac[name]);
}

export function useQtplasmacPin(name: string): PlasmaPinValue | undefined {
  return useAppStore((s) => s.plasmaPins.qtplasmac[name]);
}

/** Boolean view of a `plasmac.*` bit pin; a missing pin reads as false. */
export function usePlasmacFlag(name: string): boolean {
  return useAppStore((s) => Boolean(s.plasmaPins.plasmac[name]));
}

/** Numeric view of a `plasmac.*` pin, or `undefined` when the pin is absent. */
export function usePlasmacNumber(name: string): number | undefined {
  return useAppStore((s) => {
    const value = s.plasmaPins.plasmac[name];
    return typeof value === 'number' ? value : typeof value === 'boolean' ? Number(value) : undefined;
  });
}

/** Whether this LinuxCNC build exports the pin at all (see `plasmaMissingPins`). */
export function usePlasmacPinPresent(name: string): boolean {
  return useAppStore((s) => !s.plasmaMissingPins.includes(`plasmac.${name}`));
}
