import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { GcodeHighlightedText } from '@/components/GcodeHighlightedText';
import {
  GmCodeCursorTooltip,
  type GmCodeCursorTooltipState,
} from '@/components/GmCodeCursorTooltip';
import { cn } from '@/lib/utils';
import { computeVisualLineCounts, contentInnerWidthPx } from '@/utils/editorWrapLayout';
import { findGmTokenAtTextIndex } from '@/utils/gmTokenAtTextIndex';
import { textareaIndexFromClientPoint } from '@/utils/textareaIndexFromPointer';

/** Einheitliche Zeilenhöhe (px) für Zeilennummern und Code – muss in beiden Spalten gleich sein */
const LINE_HEIGHT_PX = 20;

/** Gleiche Schriftmetrik wie `text-sm` (14px), explizit für Textarea + Nummern (sonst driftet die Browser-Default-Textarea) */
const EDIT_LINE_TEXT_STYLE = {
  fontSize: '0.875rem',
  lineHeight: `${LINE_HEIGHT_PX}px`,
} as const;

const EDIT_PADDING_Y = 8;

type ProgramEditorEditableBodyProps = {
  content: string;
  onChange?: (value: string) => void;
  onLineNumberClick?: (line1Based: number) => void;
};

/** Bearbeitbarer Editor inkl. G/M-Cursor-Tooltip: Tooltip-Updates rendern nicht `ProgramScreen` erneut. */
const ProgramEditorEditableBody = memo(function ProgramEditorEditableBody({
  content,
  onChange,
  onLineNumberClick,
}: ProgramEditorEditableBodyProps) {
  const highlightPreRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const codeColumnRef = useRef<HTMLDivElement>(null);
  const visualLineCountsRef = useRef<number[]>([]);
  const editorPointerRafRef = useRef<number | null>(null);
  const [editorGmTooltip, setEditorGmTooltip] = useState<GmCodeCursorTooltipState | null>(null);
  const [layoutGen, setLayoutGen] = useState(0);
  const [visualPerLine, setVisualPerLine] = useState<number[]>([1]);

  // One split of `content` for gutter rendering, wrap measurement, and min-height math.
  const lines = useMemo(() => content.split('\n'), [content]);
  const hasContent = lines.length > 0 && (lines.length > 1 || lines[0] !== '');
  const paddingY = EDIT_PADDING_Y;

  useEffect(() => {
    const el = codeColumnRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(() => {
      setLayoutGen((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) {
      return;
    }
    const inner = contentInnerWidthPx(ta);
    setVisualPerLine(computeVisualLineCounts(lines, ta, inner, LINE_HEIGHT_PX));
  }, [lines, layoutGen]);

  useEffect(
    () => () => {
      if (editorPointerRafRef.current !== null) {
        cancelAnimationFrame(editorPointerRafRef.current);
      }
    },
    [],
  );

  const handleEditorPointerMove = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;
      if (!ta || !content) {
        setEditorGmTooltip(null);
        return;
      }
      if (editorPointerRafRef.current !== null) {
        cancelAnimationFrame(editorPointerRafRef.current);
      }
      editorPointerRafRef.current = requestAnimationFrame(() => {
        editorPointerRafRef.current = null;
        const idx = textareaIndexFromClientPoint(ta, e.clientX, e.clientY, {
          visualLineCounts: visualLineCountsRef.current,
          lineHeightPx: LINE_HEIGHT_PX,
        });
        const hit = findGmTokenAtTextIndex(content, idx);
        if (!hit) {
          setEditorGmTooltip(null);
          return;
        }
        setEditorGmTooltip({ hit, clientX: e.clientX, clientY: e.clientY });
      });
    },
    [content],
  );

  const handleEditorPointerLeave = useCallback(() => {
    setEditorGmTooltip(null);
  }, []);

  const safeVisual = useMemo(
    () =>
      visualPerLine.length === lines.length ? visualPerLine : lines.map(() => 1),
    [lines, visualPerLine],
  );

  // Keep ref in sync for rAF tooltip handler without mutating refs during render.
  useLayoutEffect(() => {
    visualLineCountsRef.current = safeVisual;
  }, [safeVisual]);

  const totalVisualLines = safeVisual.reduce((a, b) => a + b, 0);
  const editorBlockMinHeight = paddingY * 2 + Math.max(totalVisualLines, 1) * LINE_HEIGHT_PX;

  return (
    <div className="flex flex-1 min-h-0 rounded-lg border border-border/40 bg-slate-900/80 overflow-hidden font-mono text-sm">
      <div className="flex flex-1 min-w-0 min-h-0 overflow-x-hidden overflow-y-auto">
        <div
          className="shrink-0 flex flex-col pl-3 pr-2 text-right text-foreground/50 select-none tabular-nums text-sm"
          style={{ paddingTop: paddingY, paddingBottom: paddingY }}
        >
          {hasContent ? (
            lines.flatMap((_, i) => {
              const lineNo = i + 1;
              const vr = safeVisual[i] ?? 1;
              const interactive = onLineNumberClick != null;
              return Array.from({ length: vr }, (_, j) => (
                <div
                  key={`${i}-${j}`}
                  role={interactive ? 'button' : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  className={cn(
                    'box-border w-10 overflow-hidden text-right',
                    interactive && 'cursor-pointer rounded-sm hover:text-foreground/80',
                  )}
                  style={{
                    height: LINE_HEIGHT_PX,
                    minHeight: LINE_HEIGHT_PX,
                    maxHeight: LINE_HEIGHT_PX,
                    ...EDIT_LINE_TEXT_STYLE,
                  }}
                  onClick={
                    interactive
                      ? (e) => {
                          e.stopPropagation();
                          onLineNumberClick(lineNo);
                        }
                      : undefined
                  }
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onLineNumberClick(lineNo);
                          }
                        }
                      : undefined
                  }
                >
                  {j === 0 ? lineNo : ''}
                </div>
              ));
            })
          ) : (
            <div
              role={onLineNumberClick ? 'button' : undefined}
              tabIndex={onLineNumberClick ? 0 : undefined}
              className={cn(
                'box-border w-10 overflow-hidden text-right',
                onLineNumberClick != null && 'cursor-pointer rounded-sm hover:text-foreground/80',
              )}
              style={{
                height: LINE_HEIGHT_PX,
                minHeight: LINE_HEIGHT_PX,
                maxHeight: LINE_HEIGHT_PX,
                ...EDIT_LINE_TEXT_STYLE,
              }}
              onClick={
                onLineNumberClick
                  ? (e) => {
                      e.stopPropagation();
                      onLineNumberClick(1);
                    }
                  : undefined
              }
              onKeyDown={
                onLineNumberClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onLineNumberClick(1);
                      }
                    }
                  : undefined
              }
            >
              1
            </div>
          )}
        </div>

        <div ref={codeColumnRef} className="relative flex-1 min-w-0 min-h-0">
          <pre
            ref={highlightPreRef}
            className="m-0 box-border min-h-0 w-full overflow-x-hidden overflow-y-hidden whitespace-pre-wrap break-words border-0 bg-transparent py-0 pl-2 pr-3 text-left pointer-events-none select-none [tab-size:4]"
            style={{
              paddingTop: paddingY,
              paddingBottom: paddingY,
              minHeight: editorBlockMinHeight,
              ...EDIT_LINE_TEXT_STYLE,
            }}
            aria-hidden
          >
            <GcodeHighlightedText text={content} multiline />
          </pre>
          <textarea
            ref={textareaRef}
            className="absolute inset-0 m-0 box-border h-full w-full min-h-0 resize-none overflow-x-hidden overflow-y-auto border-0 bg-transparent py-0 pl-2 pr-3 text-transparent caret-foreground outline-none ring-0 whitespace-pre-wrap break-words selection:bg-primary/30 [tab-size:4]"
            style={{
              paddingTop: paddingY,
              paddingBottom: paddingY,
              minHeight: editorBlockMinHeight,
              ...EDIT_LINE_TEXT_STYLE,
            }}
            value={content}
            onChange={(e) => onChange?.(e.target.value)}
            onMouseMove={handleEditorPointerMove}
            onMouseLeave={handleEditorPointerLeave}
            onScroll={(e) => {
              const pre = highlightPreRef.current;
              if (!pre) return;
              pre.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
          />
        </div>
      </div>

      <GmCodeCursorTooltip state={editorGmTooltip} />
    </div>
  );
});

type ProgramEditorReadOnlyBodyProps = {
  content: string;
  currentLineIndex: number | null;
  onLineNumberClick?: (line1Based: number) => void;
  currentLineRef: React.RefObject<HTMLDivElement | null>;
};

const ProgramEditorReadOnlyBody = memo(function ProgramEditorReadOnlyBody({
  content,
  currentLineIndex,
  onLineNumberClick,
  currentLineRef,
}: ProgramEditorReadOnlyBodyProps) {
  const { t } = useTranslation('program');
  const lines = useMemo(() => content.split('\n'), [content]);
  const hasContent = lines.length > 0 && (lines.length > 1 || lines[0] !== '');
  const firstCodeCellRef = useRef<HTMLDivElement>(null);
  const [layoutGen, setLayoutGen] = useState(0);
  const [visualPerLine, setVisualPerLine] = useState<number[]>(() => lines.map(() => 1));

  useEffect(() => {
    if (!hasContent) return;
    const el = firstCodeCellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setLayoutGen((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasContent]);

  useLayoutEffect(() => {
    if (!hasContent) return;
    const probe = firstCodeCellRef.current;
    if (!probe) return;
    const inner = contentInnerWidthPx(probe);
    setVisualPerLine(computeVisualLineCounts(lines, probe, inner, LINE_HEIGHT_PX));
  }, [content, hasContent, layoutGen, lines]);

  const safeVisual =
    visualPerLine.length === lines.length ? visualPerLine : lines.map(() => 1);

  return (
    <div className="flex flex-1 min-h-0 rounded-lg border border-border/40 bg-slate-900/80 overflow-hidden font-mono text-sm">
      <div className="flex flex-1 min-w-0 min-h-0 overflow-x-hidden overflow-y-auto py-2">
        {hasContent ? (
          <div className="flex flex-col w-full min-w-0">
            {lines.map((line, i) => {
              const isCurrent = currentLineIndex != null && i === currentLineIndex;
              const vr = safeVisual[i] ?? 1;
              const interactive = onLineNumberClick != null;
              return (
                <div
                  key={i}
                  ref={isCurrent ? currentLineRef : undefined}
                  className={cn(
                    'flex min-w-0',
                    isCurrent ? 'bg-primary/20 text-primary-foreground' : '',
                  )}
                >
                  <div className="shrink-0 flex flex-col pl-3 pr-2 text-right text-foreground/50 select-none tabular-nums">
                    {Array.from({ length: vr }, (_, j) => (
                      <div
                        key={j}
                        role={interactive ? 'button' : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        className={cn(
                          'box-border w-10 overflow-hidden text-right',
                          interactive && 'cursor-pointer rounded-sm hover:text-foreground/80',
                        )}
                        style={{
                          height: LINE_HEIGHT_PX,
                          minHeight: LINE_HEIGHT_PX,
                          maxHeight: LINE_HEIGHT_PX,
                          ...EDIT_LINE_TEXT_STYLE,
                        }}
                        onClick={
                          interactive
                            ? (e) => {
                                e.stopPropagation();
                                onLineNumberClick(i + 1);
                              }
                            : undefined
                        }
                        onKeyDown={
                          interactive
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onLineNumberClick(i + 1);
                                }
                              }
                            : undefined
                        }
                      >
                        {j === 0 ? i + 1 : ''}
                      </div>
                    ))}
                  </div>
                  <div
                    ref={i === 0 ? firstCodeCellRef : undefined}
                    className={cn(
                      'min-w-0 flex-1 pr-3 whitespace-pre-wrap break-words [tab-size:4]',
                      isCurrent ? 'border-l-2 border-primary pl-1' : 'pl-0',
                    )}
                    style={EDIT_LINE_TEXT_STYLE}
                  >
                    {line ? (
                      <GcodeHighlightedText text={line} plainInherit={isCurrent} gmHover />
                    ) : (
                      '\u00a0'
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-2 text-foreground/40">{t('editorEmpty')}</div>
        )}
      </div>
    </div>
  );
});

type ProgramEditorProps = {
  content: string;
  currentLineIndex: number | null;
  editable: boolean;
  onChange?: (value: string) => void;
  /** Optional: Klick auf Zeilennummer öffnet „Ausführen ab Zeile…“ (Program-Screen). */
  onLineNumberClick?: (line1Based: number) => void;
};

export function ProgramEditor({
  content,
  currentLineIndex,
  editable,
  onChange,
  onLineNumberClick,
}: ProgramEditorProps) {
  const currentLineRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const dispatchChange = useCallback((value: string) => {
    onChangeRef.current?.(value);
  }, []);

  useEffect(() => {
    if (currentLineIndex == null || currentLineIndex < 0) return;
    currentLineRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentLineIndex]);

  if (editable) {
    return (
      <ProgramEditorEditableBody
        content={content}
        onChange={dispatchChange}
        onLineNumberClick={onLineNumberClick}
      />
    );
  }

  return (
    <ProgramEditorReadOnlyBody
      content={content}
      currentLineIndex={currentLineIndex}
      onLineNumberClick={onLineNumberClick}
      currentLineRef={currentLineRef}
    />
  );
}
