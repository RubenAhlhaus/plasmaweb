import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { APP_TOOLTIP_SURFACE_CLASS } from '@/lib/appTooltipSurfaceClass';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PANEL_W,
  FALLBACK_PANEL_H,
  gmTooltipViewportPositionEstimate,
  gmTooltipViewportPositionNearPointer,
} from '@/utils/gmTooltipViewportPosition';

export { APP_TOOLTIP_SURFACE_CLASS };

const SHOW_DELAY_MS = 400;
const HIDE_DELAY_MS = 220;

function tooltipContentIsEmpty(content: ReactNode): boolean {
  if (content == null) return true;
  if (typeof content === 'string') return content.trim().length === 0;
  if (typeof content === 'number' || typeof content === 'boolean') return false;
  return false;
}

/** Primitive `content` changes trigger layout remeasure; arbitrary React nodes are treated as one bucket. */
function contentSignature(c: ReactNode): string {
  if (typeof c === 'string') return `str:${c}`;
  if (typeof c === 'number') return `num:${c}`;
  if (typeof c === 'boolean') return `bool:${c}`;
  return 'node';
}

type AppTooltipProps = {
  content: ReactNode;
  children: ReactElement;
  /** When true, never show a tooltip (children still render). */
  disabled?: boolean;
  className?: string;
  /** Use `div` for flex rows/columns; default `span` keeps inline layout. */
  as?: 'span' | 'div';
  cursor?: 'default' | 'help';
};

export function AppTooltip({
  content,
  children,
  disabled = false,
  className,
  as: As = 'span',
  cursor = 'default',
}: AppTooltipProps) {
  const pointerRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: DEFAULT_PANEL_W, h: FALLBACK_PANEL_H });
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inactive = disabled || tooltipContentIsEmpty(content);

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
    if (inactive) return;
    clearHideTimer();
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      const { x, y } = pointerRef.current;
      setCoords(gmTooltipViewportPositionEstimate(x, y));
      setVisible(true);
    }, SHOW_DELAY_MS);
  }, [inactive, clearHideTimer, clearShowTimer]);

  const scheduleHide = useCallback(() => {
    clearShowTimer();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setCoords(null);
    }, HIDE_DELAY_MS);
  }, [clearShowTimer]);

  useLayoutEffect(() => {
    if (!visible || inactive) return;
    const el = tooltipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = r.width > 0 ? r.width : DEFAULT_PANEL_W;
    const h = r.height > 0 ? r.height : FALLBACK_PANEL_H;
    sizeRef.current = { w, h };
    const { x, y } = pointerRef.current;
    setCoords(gmTooltipViewportPositionNearPointer(x, y, w, h));
  }, [visible, inactive, contentSignature(content)]);

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
      if (visible && !inactive) {
        const { w, h } = sizeRef.current;
        setCoords(gmTooltipViewportPositionNearPointer(e.clientX, e.clientY, w, h));
      }
    },
    [visible, inactive],
  );

  useEffect(
    () => () => {
      clearShowTimer();
      clearHideTimer();
    },
    [clearHideTimer, clearShowTimer],
  );

  useEffect(() => {
    if (inactive) {
      clearShowTimer();
      clearHideTimer();
      setVisible(false);
      setCoords(null);
    }
  }, [inactive, clearHideTimer, clearShowTimer]);

  const Wrapper = As as ElementType;
  const wrapperClassName = cn(
    As === 'span' && 'inline-flex max-w-full',
    cursor === 'help' && 'cursor-help',
    className,
  );

  const { x, y } = pointerRef.current;
  const displayCoords = coords ?? gmTooltipViewportPositionEstimate(x, y);

  if (inactive) {
    return <Wrapper className={wrapperClassName}>{children}</Wrapper>;
  }

  return (
    <>
      <Wrapper
        className={wrapperClassName}
        onMouseEnter={handlePointerEnter}
        onMouseMove={handlePointerMove}
        onMouseLeave={scheduleHide}
      >
        {children}
      </Wrapper>
      {visible
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              className={APP_TOOLTIP_SURFACE_CLASS}
              style={{ left: displayCoords.left, top: displayCoords.top }}
            >
              {typeof content === 'string' ? (
                <p className="text-sm text-foreground/90 whitespace-pre-wrap m-0">{content}</p>
              ) : (
                <div className="text-sm text-foreground/90 whitespace-pre-wrap">{content}</div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
