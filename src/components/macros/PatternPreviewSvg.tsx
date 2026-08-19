import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PatternPoint } from '@/lib/macroGcode/expandPatternPositions';

const PREVIEW_PAD_RATIO = 0.08;
const MIN_VIEW_EXTENT_MM = 14;
const HOLE_R_MIN = 0.7;
const HOLE_R_MAX = 3.2;
const HOLE_R_FRAC_OF_SPAN = 0.022;

type PatternPreviewSvgProps = {
  points: PatternPoint[];
  className?: string;
  /** Plan view: X right, Y up (machine Y mapped with a flip). */
  ariaLabel?: string;
  /** Polar / round layout: bolt-circle centre in machine X/Y (mm). */
  roundCenterMm?: { x: number; y: number } | null;
  /** Larger / brighter centre marker, e.g. when centre X/Y fields are active. */
  centerMarkerEmphasized?: boolean;
  /** Rectangular grid: first hole (start X / start Y) in machine X/Y (mm). */
  rectGridOriginMm?: { x: number; y: number } | null;
  /** Emphasis when start X/Y fields are active. */
  rectOriginMarkerEmphasized?: boolean;
};

function PreviewGreenReferenceMarker({
  svgX,
  svgY,
  holeR,
  emphasized,
  title,
}: {
  svgX: number;
  svgY: number;
  holeR: number;
  emphasized: boolean;
  title: string;
}) {
  const [hovered, setHovered] = useState(false);
  const hitR = Math.max(3.2, holeR * 2.4);
  const dotBase = Math.min(1.35, Math.max(0.75, holeR * 0.42));
  const dotR = dotBase * (hovered ? 1.55 : 1) * (emphasized ? 1.35 : 1);

  return (
    <g className="text-emerald-500">
      <title>{title}</title>
      <circle
        cx={svgX}
        cy={svgY}
        r={hitR}
        className="fill-transparent stroke-transparent"
        pointerEvents="all"
        style={{ cursor: 'default' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {(emphasized || hovered) && (
        <circle
          cx={svgX}
          cy={svgY}
          r={dotR + Math.max(0.8, dotR * 0.5)}
          className="fill-emerald-400/35 stroke-emerald-500/40"
          strokeWidth={Math.max(0.1, dotR * 0.08)}
          pointerEvents="none"
        />
      )}
      <circle
        cx={svgX}
        cy={svgY}
        r={dotR}
        className="fill-emerald-500 stroke-emerald-700/90"
        strokeWidth={Math.max(0.1, dotR * 0.15)}
        pointerEvents="none"
      />
    </g>
  );
}

function boundsForPreview(points: PatternPoint[]): {
  minX: number;
  maxX: number;
  minYs: number;
  maxYs: number;
} | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minYs = -points[0].y;
  let maxYs = -points[0].y;
  for (let i = 1; i < points.length; i++) {
    const { x, y } = points[i];
    const ys = -y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (ys < minYs) minYs = ys;
    if (ys > maxYs) maxYs = ys;
  }
  return { minX, maxX, minYs, maxYs };
}

export function PatternPreviewSvg({
  points,
  className,
  ariaLabel,
  roundCenterMm = null,
  centerMarkerEmphasized = false,
  rectGridOriginMm = null,
  rectOriginMarkerEmphasized = false,
}: PatternPreviewSvgProps) {
  const { t } = useTranslation('macros');
  const resolvedAriaLabel = ariaLabel ?? t('patternUi.patternPreviewDefaultAria');
  const layout = useMemo(() => {
    const b = boundsForPreview(points);
    if (!b) return null;
    const spanX = b.maxX - b.minX;
    const spanY = b.maxYs - b.minYs;
    const span = Math.max(spanX, spanY, MIN_VIEW_EXTENT_MM);
    const pad = Math.max(span * PREVIEW_PAD_RATIO, 2);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minYs + b.maxYs) / 2;
    const half = span / 2 + pad;
    const vbMinX = cx - half;
    const vbMinY = cy - half;
    const vbW = half * 2;
    const vbH = half * 2;
    const holeR = Math.min(
      HOLE_R_MAX,
      Math.max(HOLE_R_MIN, span * HOLE_R_FRAC_OF_SPAN),
    );
    return { vbMinX, vbMinY, vbW, vbH, holeR };
  }, [points]);

  if (!layout || points.length === 0) {
    return (
      <div
        className={cn(
          'flex aspect-square w-full max-w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/15 px-2 text-center text-xs text-muted-foreground',
          className,
        )}
        role="img"
        aria-label={resolvedAriaLabel}
      >
        {t('patternUi.noPreview')}
      </div>
    );
  }

  const { vbMinX, vbMinY, vbW, vbH, holeR } = layout;

  const centerCoords =
    roundCenterMm != null &&
    Number.isFinite(roundCenterMm.x) &&
    Number.isFinite(roundCenterMm.y)
      ? { svgX: roundCenterMm.x, svgY: -roundCenterMm.y }
      : null;
  const showRoundCenter = centerCoords != null;

  const rectOriginCoords =
    rectGridOriginMm != null &&
    Number.isFinite(rectGridOriginMm.x) &&
    Number.isFinite(rectGridOriginMm.y)
      ? { svgX: rectGridOriginMm.x, svgY: -rectGridOriginMm.y }
      : null;
  const showRectOrigin = rectOriginCoords != null;

  return (
    <svg
      viewBox={`${vbMinX} ${vbMinY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn('h-auto w-full text-foreground', className)}
      role="img"
      aria-label={resolvedAriaLabel}
    >
      <rect
        x={vbMinX}
        y={vbMinY}
        width={vbW}
        height={vbH}
        className="fill-muted/25 stroke-border/50"
        strokeWidth={Math.max(0.15, Math.min(vbW, vbH) * 0.002)}
        rx={Math.max(0.2, Math.min(vbW, vbH) * 0.006)}
      />
      {points.map((p, i) => (
        <circle
          key={`hole-${i}`}
          cx={p.x}
          cy={-p.y}
          r={holeR}
          className="fill-primary/85 stroke-primary"
          strokeWidth={Math.max(0.12, holeR * 0.12)}
        />
      ))}
      {showRoundCenter && centerCoords ? (
        <PreviewGreenReferenceMarker
          svgX={centerCoords.svgX}
          svgY={centerCoords.svgY}
          holeR={holeR}
          emphasized={centerMarkerEmphasized}
          title="Lochkreis-Mitte (Mitte X / Mitte Y)"
        />
      ) : null}
      {showRectOrigin && rectOriginCoords ? (
        <PreviewGreenReferenceMarker
          svgX={rectOriginCoords.svgX}
          svgY={rectOriginCoords.svgY}
          holeR={holeR}
          emphasized={rectOriginMarkerEmphasized}
          title="Raster-Startpunkt (Start X / Start Y)"
        />
      ) : null}
    </svg>
  );
}
