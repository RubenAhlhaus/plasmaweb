/** Format a number for G-code (no scientific notation, trim trailing zeros). */
export function formatGCodeNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  let s = value.toFixed(4);
  s = s.replace(/(\.\d*?)0+$/, '$1');
  s = s.replace(/\.$/, '');
  return s.length > 0 ? s : '0';
}
