import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_TOOLTIP_SURFACE_CLASS } from '@/lib/appTooltipSurfaceClass';
import { GmCodeReferenceBody } from '@/components/GmCodeReferenceBody';
import type { GmTokenHit } from '@/utils/gmTokenAtTextIndex';
import {
  DEFAULT_PANEL_W,
  FALLBACK_PANEL_H,
  gmTooltipViewportPositionNearPointer,
} from '@/utils/gmTooltipViewportPosition';

export type GmCodeCursorTooltipState = {
  hit: GmTokenHit;
  clientX: number;
  clientY: number;
};

type GmCodeCursorTooltipProps = {
  state: GmCodeCursorTooltipState | null;
};

export function GmCodeCursorTooltip({ state }: GmCodeCursorTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: DEFAULT_PANEL_W, h: FALLBACK_PANEL_H });
  const prevHitKeyRef = useRef<string | null>(null);
  const [, setLayoutTick] = useState(0);

  const hitKey = state ? `${state.hit.kind}:${state.hit.label}` : '';

  if (state && prevHitKeyRef.current !== hitKey) {
    prevHitKeyRef.current = hitKey;
    sizeRef.current = { w: DEFAULT_PANEL_W, h: FALLBACK_PANEL_H };
  }

  useLayoutEffect(() => {
    if (!hitKey) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nw = r.width > 0 ? r.width : DEFAULT_PANEL_W;
    const nh = r.height > 0 ? r.height : FALLBACK_PANEL_H;
    const ow = sizeRef.current.w;
    const oh = sizeRef.current.h;
    sizeRef.current = { w: nw, h: nh };
    if (nw !== ow || nh !== oh) {
      setLayoutTick((n) => n + 1);
    }
  }, [hitKey]);

  if (!state) {
    return null;
  }

  const { hit, clientX, clientY } = state;
  const { w, h } = sizeRef.current;
  const { left, top } = gmTooltipViewportPositionNearPointer(clientX, clientY, w, h);

  return createPortal(
    <div ref={ref} role="tooltip" className={APP_TOOLTIP_SURFACE_CLASS} style={{ left, top }}>
      <p className="text-sm font-semibold text-foreground mb-2">{hit.label}</p>
      <GmCodeReferenceBody kind={hit.kind} label={hit.label} compact />
    </div>,
    document.body,
  );
}
