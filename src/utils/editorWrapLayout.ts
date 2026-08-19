/**
 * Ermittelt, wie viele sichtbare Textzeilen eine logische Zeile bei `white-space: pre-wrap`
 * mit gegebener Inhaltsbreite einnimmt (DOM-Messung, orientiert am Browser-Layout).
 */

let sharedMeasurer: HTMLDivElement | null = null;

function getSharedMeasurer(): HTMLDivElement {
  if (!sharedMeasurer) {
    sharedMeasurer = document.createElement('div');
    sharedMeasurer.setAttribute('aria-hidden', 'true');
    sharedMeasurer.style.position = 'absolute';
    sharedMeasurer.style.left = '-99999px';
    sharedMeasurer.style.top = '0';
    sharedMeasurer.style.visibility = 'hidden';
    sharedMeasurer.style.pointerEvents = 'none';
    sharedMeasurer.style.boxSizing = 'border-box';
    sharedMeasurer.style.padding = '0';
    sharedMeasurer.style.margin = '0';
    sharedMeasurer.style.border = '0';
    document.body.appendChild(sharedMeasurer);
  }
  return sharedMeasurer;
}

function applyMeasurerTypography(measurer: HTMLDivElement, source: HTMLElement, lineHeightPx: number): void {
  const cs = window.getComputedStyle(source);
  measurer.style.fontFamily = cs.fontFamily;
  measurer.style.fontSize = cs.fontSize;
  measurer.style.fontWeight = cs.fontWeight;
  measurer.style.fontStyle = cs.fontStyle;
  measurer.style.fontVariant = cs.fontVariant;
  measurer.style.letterSpacing = cs.letterSpacing;
  measurer.style.fontFeatureSettings = cs.fontFeatureSettings;
  measurer.style.fontVariantNumeric = cs.fontVariantNumeric;
  measurer.style.tabSize = cs.tabSize;
  measurer.style.lineHeight = `${lineHeightPx}px`;
  measurer.style.whiteSpace = 'pre-wrap';
  measurer.style.overflowWrap = 'break-word';
  measurer.style.wordBreak = 'break-word';
}

/**
 * @param contentWidthPx Breite des Textbereichs (ohne Padding), wie im Editor.
 */
export function measureVisualRowsForLine(
  line: string,
  source: HTMLElement,
  contentWidthPx: number,
  lineHeightPx: number,
): number {
  if (contentWidthPx <= 0) {
    return 1;
  }
  const measurer = getSharedMeasurer();
  applyMeasurerTypography(measurer, source, lineHeightPx);
  measurer.style.width = `${contentWidthPx}px`;
  if (line.length === 0) {
    measurer.textContent = '';
    measurer.style.minHeight = `${lineHeightPx}px`;
  } else {
    measurer.textContent = line;
    measurer.style.minHeight = '0';
  }
  const h = measurer.offsetHeight;
  return Math.max(1, Math.round(h / lineHeightPx));
}

export function computeVisualLineCounts(
  lines: string[],
  source: HTMLElement,
  contentWidthPx: number,
  lineHeightPx: number,
): number[] {
  if (lines.length === 0) {
    return [1];
  }
  return lines.map((line) =>
    measureVisualRowsForLine(line, source, contentWidthPx, lineHeightPx),
  );
}

/** Innere Textbreite eines Elements (clientWidth abzüglich horizontalen Paddings). */
export function contentInnerWidthPx(el: HTMLElement): number {
  const cs = window.getComputedStyle(el);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  return Math.max(0, el.clientWidth - padL - padR);
}
