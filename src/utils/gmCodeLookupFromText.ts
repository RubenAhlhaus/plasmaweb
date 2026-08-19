export type GmLookupKind = 'g' | 'm';

/**
 * Maps a highlighted G- or M-word token (e.g. "G01", "g0", "g 1.5", "m3") to a
 * `linuxCncGcodeMcodeReference.json` key via `lookupCodeReference`.
 * Matching is case-insensitive on the letter and uses the full trimmed segment text
 * (LinuxCNC allows lower-case G/M words). Only the string shape matters — there is
 * no separate token-kind filter; callers should pass the exact segment text from
 * `tokenizeGcodeLine` / `tokenizeGcode`.
 */
export function gmLookupKeyFromTokenText(
  text: string,
): { kind: GmLookupKind; label: string } | null {
  const t = text.trim();
  const m = /^([gm])\s*(\d+)(\.\d+)?$/i.exec(t);
  if (!m) {
    return null;
  }
  const letter = m[1].toUpperCase() as 'G' | 'M';
  const kind: GmLookupKind = letter === 'G' ? 'g' : 'm';
  const intPart = String(parseInt(m[2], 10));
  const fracRaw = m[3];
  if (!fracRaw) {
    return { kind, label: `${letter}${intPart}` };
  }
  const fracDigits = fracRaw.slice(1).replace(/0+$/, '');
  if (fracDigits === '') {
    return { kind, label: `${letter}${intPart}` };
  }
  return { kind, label: `${letter}${intPart}.${fracDigits}` };
}
