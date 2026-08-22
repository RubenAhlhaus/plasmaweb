import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlasmaToolpath, PlasmaToolpathSegment } from '@/store/types';

export type ToolpathCanvasProps = {
  toolpath: PlasmaToolpath;
  /** Live machine position, drawn as the torch. */
  torch?: { x: number; y: number } | null;
  /** The line the interpreter is currently running, highlighted. */
  activeLine?: number | null;
  /** The line the operator picked (run-from-line), highlighted differently. */
  selectedLine?: number | null;
  onPickLine?: (line: number) => void;
  className?: string;
};

type View = { scale: number; offsetX: number; offsetY: number };

const COLORS = {
  rapid: 'rgba(148, 163, 184, 0.55)',
  feed: '#38bdf8',
  active: '#fbbf24',
  selected: '#f472b6',
  torch: '#ef4444',
  grid: 'rgba(148, 163, 184, 0.14)',
};

/** Top-down view: machine Y grows away from the operator, canvas Y grows downwards. */
function fitView(toolpath: PlasmaToolpath, width: number, height: number): View {
  const extents = toolpath.extents;
  if (!extents || width <= 0 || height <= 0) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 };
  }
  const spanX = Math.max(extents.max[0] - extents.min[0], 1e-6);
  const spanY = Math.max(extents.max[1] - extents.min[1], 1e-6);
  const margin = 24;
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  const midX = (extents.max[0] + extents.min[0]) / 2;
  const midY = (extents.max[1] + extents.min[1]) / 2;
  return {
    scale,
    offsetX: width / 2 - midX * scale,
    offsetY: height / 2 + midY * scale,
  };
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The cut segment nearest to a machine-coordinate point, within `tolerance`. */
export function nearestSegment(
  segments: PlasmaToolpathSegment[],
  x: number,
  y: number,
  tolerance: number,
): PlasmaToolpathSegment | null {
  let best: PlasmaToolpathSegment | null = null;
  let bestDistance = tolerance;
  for (const segment of segments) {
    for (let i = 1; i < segment.pts.length; i += 1) {
      const a = segment.pts[i - 1];
      const b = segment.pts[i];
      const distance = distanceToSegment(x, y, a[0], a[1], b[0], b[1]);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = segment;
      }
    }
  }
  return best;
}

/**
 * The program preview, drawn from the segments LinuxCNC's interpreter produced.
 *
 * Canvas2D and top-down on purpose: a plasma table cuts flat sheet, so the useful view is XY,
 * and a canvas keeps a 200k-point program interactive on the kind of machine that sits in a
 * workshop — which an SVG of the same program would not.
 *
 * Clicking a cut is how run-from-line is picked, so the hit test walks the actual polylines
 * rather than a bounding box.
 */
export function ToolpathCanvas({
  toolpath,
  torch,
  activeLine,
  selectedLine,
  onPickLine,
  className,
}: ToolpathCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // Refit when the program or the box changes; a manual pan/zoom survives a redraw.
  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      setView(fitView(toolpath, size.width, size.height));
    }
  }, [toolpath, size.width, size.height]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toCanvas = useCallback(
    (x: number, y: number): [number, number] => {
      if (!view) return [0, 0];
      return [x * view.scale + view.offsetX, view.offsetY - y * view.scale];
    },
    [view],
  );

  const toMachine = useCallback(
    (cx: number, cy: number): [number, number] => {
      if (!view) return [0, 0];
      return [(cx - view.offsetX) / view.scale, (view.offsetY - cy) / view.scale];
    },
    [view],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.width === 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    // Machine origin, so the operator can see where the program sits on the table.
    const [originX, originY] = toCanvas(0, 0);
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, originY);
    context.lineTo(size.width, originY);
    context.moveTo(originX, 0);
    context.lineTo(originX, size.height);
    context.stroke();

    const draw = (segment: PlasmaToolpathSegment) => {
      context.beginPath();
      segment.pts.forEach((point, index) => {
        const [cx, cy] = toCanvas(point[0], point[1]);
        if (index === 0) context.moveTo(cx, cy);
        else context.lineTo(cx, cy);
      });
      context.stroke();
    };

    // Rapids first, so a cut is never hidden under a traverse.
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.strokeStyle = COLORS.rapid;
    toolpath.segments.filter((s) => s.kind === 'rapid').forEach(draw);

    context.setLineDash([]);
    context.lineWidth = 2;
    for (const segment of toolpath.segments) {
      if (segment.kind !== 'feed') continue;
      if (segment.line === activeLine) context.strokeStyle = COLORS.active;
      else if (segment.line === selectedLine) context.strokeStyle = COLORS.selected;
      else context.strokeStyle = COLORS.feed;
      draw(segment);
    }

    if (torch) {
      const [tx, ty] = toCanvas(torch.x, torch.y);
      context.fillStyle = COLORS.torch;
      context.beginPath();
      context.arc(tx, ty, 4, 0, Math.PI * 2);
      context.fill();
    }
  }, [toolpath, view, size, toCanvas, torch, activeLine, selectedLine]);

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!view) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const [mx, my] = toMachine(cx, cy);
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.min(Math.max(view.scale * factor, 0.01), 500);
    // Keep the point under the cursor still, which is what makes zoom feel like zoom.
    setView({ scale, offsetX: cx - mx * scale, offsetY: cy + my * scale });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !view) return;
    setView({
      scale: view.scale,
      offsetX: drag.offsetX + (event.clientX - drag.x),
      offsetY: drag.offsetY + (event.clientY - drag.y),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !view || !onPickLine) return;
    // A drag pans; only a tap picks a line.
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const [mx, my] = toMachine(event.clientX - rect.left, event.clientY - rect.top);
    const segment = nearestSegment(
      toolpath.segments.filter((s) => s.kind === 'feed'),
      mx,
      my,
      12 / view.scale,
    );
    if (segment) onPickLine(segment.line);
  };

  const reset = useMemo(
    () => () => setView(fitView(toolpath, size.width, size.height)),
    [toolpath, size.width, size.height],
  );

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className ?? ''}`} data-e2e="toolpath-canvas">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        style={{ width: size.width, height: size.height }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragRef.current = null;
        }}
      />
      <button
        type="button"
        className="absolute right-2 top-2 rounded border border-border/40 bg-card/80 px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        data-e2e="toolpath-fit"
        onClick={reset}
      >
        Fit
      </button>
    </div>
  );
}
