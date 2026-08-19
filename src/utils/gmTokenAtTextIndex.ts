import { tokenizeGcodeLine } from '@/utils/gcodeSyntax';
import { gmLookupKeyFromTokenText, type GmLookupKind } from '@/utils/gmCodeLookupFromText';

export type GmTokenHit = { kind: GmLookupKind; label: string };

/**
 * If `index` falls inside a G- or M-word token on that line, returns its lookup key.
 */
export function findGmTokenAtTextIndex(text: string, index: number): GmTokenHit | null {
  if (index < 0 || index > text.length) {
    return null;
  }
  const before = text.slice(0, index);
  const lineStart = before.lastIndexOf('\n') + 1;
  const nl = text.indexOf('\n', index);
  const lineEnd = nl === -1 ? text.length : nl;
  const line = text.slice(lineStart, lineEnd);
  const col = index - lineStart;

  let pos = 0;
  for (const seg of tokenizeGcodeLine(line)) {
    const len = seg.text.length;
    const end = pos + len;
    if (col >= pos && col < end) {
      if (seg.part !== undefined) {
        return null;
      }
      return gmLookupKeyFromTokenText(seg.text);
    }
    pos = end;
  }
  return null;
}
