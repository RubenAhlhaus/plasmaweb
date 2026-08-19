/** Decimal places used when displaying machine coordinates/positions. */
export const COORDINATE_DISPLAY_DECIMALS = 3;

/** Formats a machine coordinate/position for display (e.g. `1` → `"1.000"`). */
export function formatMachineCoordinate(value: number): string {
  return value.toFixed(COORDINATE_DISPLAY_DECIMALS);
}
