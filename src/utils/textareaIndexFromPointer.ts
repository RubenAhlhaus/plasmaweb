const charWidthCache = new WeakMap<HTMLElement, number>();

function measureCharWidth(el: HTMLElement): number {
  const cached = charWidthCache.get(el);
  if (cached !== undefined) {
    return cached;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return 8;
  }
  ctx.font = window.getComputedStyle(el).font;
  /** Monospace fonts should be uniform; use max width so column math stays stable for g/G/m/M. */
  const sample = 'MWgm019.';
  let w = 0;
  for (let i = 0; i < sample.length; i += 1) {
    w = Math.max(w, ctx.measureText(sample.charAt(i)).width);
  }
  w = w || ctx.measureText('M').width || 8;
  charWidthCache.set(el, w);
  return w;
}

/** Single-line text (MDI input): column from X position. */
export function singleLineInputIndexFromClientPoint(
  input: HTMLInputElement,
  clientX: number,
): number {
  const rect = input.getBoundingClientRect();
  const cs = window.getComputedStyle(input);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const borderL = parseFloat(cs.borderLeftWidth) || 0;
  const x = clientX - rect.left - borderL - padL + input.scrollLeft;
  const charW = measureCharWidth(input);
  const col = Math.max(0, Math.round(x / charW));
  return Math.min(col, input.value.length);
}

export type TextareaIndexFromPointOptions = {
  /** Per logical line: number of visual rows after soft wrap (same as line-number gutter). */
  visualLineCounts?: readonly number[];
  /** Fixed line height in px when it must not follow `getComputedStyle`. */
  lineHeightPx?: number;
};

/**
 * Approximate character offset in a monospace textarea from viewport coordinates.
 * Good enough for G/M hover next to `GcodeHighlightedText` overlays.
 * With `visualLineCounts`, Y maps through wrapped rows; X still uses chars-per-row heuristics,
 * so the index can be slightly off from the real caret on long wrapped lines.
 */
export function textareaIndexFromClientPoint(
  textarea: HTMLTextAreaElement,
  clientX: number,
  clientY: number,
  options?: TextareaIndexFromPointOptions,
): number {
  const rect = textarea.getBoundingClientRect();
  const cs = window.getComputedStyle(textarea);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const borderL = parseFloat(cs.borderLeftWidth) || 0;
  const borderT = parseFloat(cs.borderTopWidth) || 0;
  const x = clientX - rect.left - borderL - padL + textarea.scrollLeft;
  const y = clientY - rect.top - borderT - padT + textarea.scrollTop;
  const lhRaw = cs.lineHeight;
  const fontSize = parseFloat(cs.fontSize) || 14;
  const lineHeight =
    options?.lineHeightPx ??
    (lhRaw === 'normal' ? fontSize * 1.25 : parseFloat(lhRaw) || fontSize * 1.25);

  const lines = textarea.value.split('\n');
  const visualCounts = options?.visualLineCounts;
  const useWrap =
    visualCounts != null && visualCounts.length === lines.length && lineHeight > 0;

  if (!useWrap) {
    const line = Math.max(0, Math.floor(y / lineHeight));
    if (line >= lines.length) {
      return textarea.value.length;
    }
    const charW = measureCharWidth(textarea);
    const col = Math.max(0, Math.round(x / charW));
    const lineText = lines[line] ?? '';
    const clampedCol = Math.min(col, lineText.length);
    let idx = 0;
    for (let i = 0; i < line; i += 1) {
      idx += (lines[i]?.length ?? 0) + 1;
    }
    return idx + clampedCol;
  }

  const totalVisual = visualCounts.reduce((a, b) => a + b, 0);
  const totalHeight = totalVisual * lineHeight;
  if (y >= totalHeight) {
    return textarea.value.length;
  }
  if (y < 0) {
    return 0;
  }

  let visualBase = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const vr = visualCounts[lineIdx] ?? 1;
    const blockH = vr * lineHeight;
    if (y < visualBase + blockH) {
      const relY = y - visualBase;
      const subRow = Math.min(vr - 1, Math.max(0, Math.floor(relY / lineHeight)));
      const lineText = lines[lineIdx] ?? '';
      const innerW = Math.max(0, textarea.clientWidth - padL - padR);
      const charW = measureCharWidth(textarea);
      const colInRow = Math.max(0, Math.round(x / charW));
      const cpr = Math.max(1, Math.floor(innerW / charW));
      const idxInLine = Math.min(lineText.length, subRow * cpr + colInRow);
      let idx = 0;
      for (let i = 0; i < lineIdx; i += 1) {
        idx += (lines[i]?.length ?? 0) + 1;
      }
      return idx + idxInLine;
    }
    visualBase += blockH;
  }

  return textarea.value.length;
}
