import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GmCodeReferenceBody, type GmReferenceKind } from '@/components/GmCodeReferenceBody';
import { APP_TOOLTIP_SURFACE_CLASS } from '@/lib/appTooltipSurfaceClass';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PANEL_W,
  FALLBACK_PANEL_H,
  gmTooltipViewportPositionEstimate,
  gmTooltipViewportPositionNearPointer,
} from '@/utils/gmTooltipViewportPosition';

const SHOW_DELAY_MS = 400;
const HIDE_DELAY_MS = 220;

type GmCodeHoverSpanProps = {
  kind: GmReferenceKind;
  label: string;
  className?: string;
  children: React.ReactNode;
};

export function GmCodeHoverSpan({ kind, label, className, children }: GmCodeHoverSpanProps) {
  const pointerRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: DEFAULT_PANEL_W, h: FALLBACK_PANEL_H });
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleShow = useCallback(() => {
    clearHideTimer();
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      const { x, y } = pointerRef.current;
      setCoords(gmTooltipViewportPositionEstimate(x, y));
      setVisible(true);
    }, SHOW_DELAY_MS);
  }, [clearHideTimer, clearShowTimer]);

  const scheduleHide = useCallback(() => {
    clearShowTimer();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setCoords(null);
    }, HIDE_DELAY_MS);
  }, [clearShowTimer]);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = tooltipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = r.width > 0 ? r.width : DEFAULT_PANEL_W;
    const h = r.height > 0 ? r.height : FALLBACK_PANEL_H;
    sizeRef.current = { w, h };
    const { x, y } = pointerRef.current;
    setCoords(gmTooltipViewportPositionNearPointer(x, y, w, h));
  }, [visible, kind, label]);

  const handlePointerEnter = useCallback(
    (e: React.MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      scheduleShow();
    },
    [scheduleShow],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (visible) {
        const { w, h } = sizeRef.current;
        setCoords(gmTooltipViewportPositionNearPointer(e.clientX, e.clientY, w, h));
      }
    },
    [visible],
  );

  useEffect(
    () => () => {
      clearShowTimer();
      clearHideTimer();
    },
    [clearHideTimer, clearShowTimer],
  );

  const { x, y } = pointerRef.current;
  const displayCoords = coords ?? gmTooltipViewportPositionEstimate(x, y);

  return (
    <>
      <span
        className={cn(
          className,
          'cursor-help underline decoration-dotted decoration-muted-foreground/45 underline-offset-2',
        )}
        onMouseEnter={handlePointerEnter}
        onMouseMove={handlePointerMove}
        onMouseLeave={scheduleHide}
      >
        {children}
      </span>
      {visible
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              className={APP_TOOLTIP_SURFACE_CLASS}
              style={{ left: displayCoords.left, top: displayCoords.top }}
            >
              <p className="text-sm font-semibold text-foreground mb-2">
                {label}
              </p>
              <GmCodeReferenceBody kind={kind} label={label} compact />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
