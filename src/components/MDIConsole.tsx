import { useState, useRef, useEffect, useCallback, memo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSendMdiCommand } from '@/hooks/useSendMdiCommand';
import { useMdiPreconditions } from '@/hooks/useMdiPreconditions';
import { cn } from '@/lib/utils';
import { GcodeHighlightedText } from '@/components/GcodeHighlightedText';
import {
  GmCodeCursorTooltip,
  type GmCodeCursorTooltipState,
} from '@/components/GmCodeCursorTooltip';
import { useAppStore } from '@/store';
import { findGmTokenAtTextIndex } from '@/utils/gmTokenAtTextIndex';
import { singleLineInputIndexFromClientPoint } from '@/utils/textareaIndexFromPointer';
import { AppTooltip } from '@/components/AppTooltip';
import { Button } from './ui/button';

type MdiInputWithGmTooltipProps = {
  input: string;
  onInputChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  isMdiDisabled: boolean;
  preconditionTooltip: string | null | undefined;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
};

/** Wraps input + G/M cursor tooltip so tooltip updates do not re-render MDI history. */
const MdiInputWithGmTooltip = memo(function MdiInputWithGmTooltip({
  input,
  onInputChange,
  inputRef,
  isMdiDisabled,
  preconditionTooltip,
  onSubmit,
  onKeyDown,
  onBlur,
}: MdiInputWithGmTooltipProps) {
  const { t } = useTranslation('components');
  const preconditionHintId = useId();
  const [mdiScrollLeft, setMdiScrollLeft] = useState(0);
  const [mdiGmTooltip, setMdiGmTooltip] = useState<GmCodeCursorTooltipState | null>(null);
  const mdiPointerRafRef = useRef<number | null>(null);
  const showPreconditionHint = Boolean(isMdiDisabled && preconditionTooltip);

  useEffect(() => {
    if (input !== '') return;
    setMdiScrollLeft(0);
    inputRef.current?.scrollTo({ left: 0 });
  }, [input, inputRef]);

  useEffect(
    () => () => {
      if (mdiPointerRafRef.current !== null) {
        cancelAnimationFrame(mdiPointerRafRef.current);
      }
    },
    [],
  );

  const handleMdiInputPointerMove = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      const el = inputRef.current;
      if (!el || !input.trim()) {
        setMdiGmTooltip(null);
        return;
      }
      if (mdiPointerRafRef.current !== null) {
        cancelAnimationFrame(mdiPointerRafRef.current);
      }
      mdiPointerRafRef.current = requestAnimationFrame(() => {
        mdiPointerRafRef.current = null;
        const idx = singleLineInputIndexFromClientPoint(el, e.clientX);
        const hit = findGmTokenAtTextIndex(input, idx);
        if (!hit) {
          setMdiGmTooltip(null);
          return;
        }
        setMdiGmTooltip({ hit, clientX: e.clientX, clientY: e.clientY });
      });
    },
    [input, inputRef],
  );

  const handleMdiInputPointerLeave = useCallback(() => {
    setMdiGmTooltip(null);
  }, []);

  return (
    <>
      <form onSubmit={onSubmit} className="p-2">
        <label htmlFor="mdi-input" className="sr-only">
          {t('mdiConsole.inputLabel')}
        </label>
        {showPreconditionHint ? (
          <span id={preconditionHintId} className="sr-only">
            {preconditionTooltip}
          </span>
        ) : null}
        <AppTooltip
          as="div"
          className="block w-full min-w-0"
          content={preconditionTooltip ?? ''}
          disabled={!isMdiDisabled || !preconditionTooltip}
        >
          <div
            className={cn(
              'flex items-stretch rounded-md border border-input bg-background/80',
              'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background',
            )}
          >
          <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
            <div
              className="pointer-events-none absolute left-0 top-0 z-0 max-h-full overflow-hidden px-3 py-2 font-mono text-sm whitespace-nowrap"
              style={{ transform: `translateX(-${mdiScrollLeft}px)` }}
              aria-hidden
            >
              {input ? (
                <GcodeHighlightedText text={input} />
              ) : (
                <span className="text-transparent">.</span>
              )}
            </div>
            <input
              ref={inputRef}
              id="mdi-input"
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onScroll={(e) => setMdiScrollLeft(e.currentTarget.scrollLeft)}
              onMouseMove={handleMdiInputPointerMove}
              onMouseLeave={handleMdiInputPointerLeave}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              placeholder={t('mdiConsole.placeholder')}
              className="relative z-10 flex-1 min-w-0 w-full min-h-0 px-3 py-2 bg-transparent font-mono text-sm text-transparent caret-foreground placeholder:text-muted-foreground selection:bg-primary/30 focus:outline-none overflow-x-auto"
              autoComplete="off"
              aria-describedby={showPreconditionHint ? preconditionHintId : undefined}
            />
          </div>
          <AppTooltip
            content={
              isMdiDisabled && preconditionTooltip ? preconditionTooltip : t('mdiConsole.send')
            }
            className="inline-flex shrink-0"
          >
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              data-e2e="mdi-send"
              className="h-auto shrink-0 rounded-l-none rounded-r-md border-0 border-l border-input/50 px-2.5 text-foreground hover:bg-white/10"
              disabled={isMdiDisabled}
            >
              <Send className="h-4 w-4" />
            </Button>
          </AppTooltip>
          </div>
        </AppTooltip>
      </form>

      <GmCodeCursorTooltip state={mdiGmTooltip} />
    </>
  );
});

export function MDIConsole() {
  const { t, i18n } = useTranslation('components');
  const [input, setInput] = useState('');
  const { history } = useAppStore(
    useShallow((s) => ({
      history: s.mdiCommandHistory,
    })),
  );
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { sendMdi } = useSendMdiCommand();
  const { canMdi, tooltip } = useMdiPreconditions();
  const isMdiDisabled = !canMdi;

  const scrollHistoryToBottom = () => {
    const container = historyContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    scrollHistoryToBottom();
  }, [history]);

  const announceBlockedSubmit = useCallback(() => {
    if (!tooltip) return;
    showErrorToast({ message: tooltip, kind: 'mdi_preconditions', tone: 'info' });
  }, [showErrorToast, tooltip]);

  const submitCommand = useCallback(
    (cmd: string) => {
      if (isMdiDisabled) return;
      const trimmed = cmd.trim();
      if (!trimmed) return;
      sendMdi(trimmed);
      setInput('');
    },
    [isMdiDisabled, sendMdi],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (isMdiDisabled) {
        if (input.trim()) announceBlockedSubmit();
        inputRef.current?.focus();
        return;
      }
      submitCommand(input);
      inputRef.current?.focus();
    },
    [announceBlockedSubmit, input, isMdiDisabled, submitCommand],
  );

  const handleHistoryClick = (item: string) => {
    setInput(item);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp') {
        if (!history.length) return;
        e.preventDefault();
        setSelectedHistoryIndex((prev) => {
          if (prev === null) return history.length - 1;
          if (prev <= 0) return 0;
          return prev - 1;
        });
        return;
      }

      if (e.key === 'ArrowDown') {
        if (!history.length) return;
        e.preventDefault();
        setSelectedHistoryIndex((prev) => {
          if (prev === null) return 0;
          if (prev >= history.length - 1) return history.length - 1;
          return prev + 1;
        });
        return;
      }

      if (e.key === 'Enter' && selectedHistoryIndex !== null) {
        e.preventDefault();
        const item = history[selectedHistoryIndex];
        if (item !== undefined) {
          setInput(item);
          setSelectedHistoryIndex(null);
        }
        return;
      }

      if (e.key === 'Enter' && isMdiDisabled) {
        e.preventDefault();
        if (input.trim()) announceBlockedSubmit();
      }
    },
    [announceBlockedSubmit, history, input, isMdiDisabled, selectedHistoryIndex],
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setSelectedHistoryIndex((prev) => (prev !== null ? null : prev));
  }, []);

  const handleInputBlur = useCallback(() => {
    if (selectedHistoryIndex !== null) {
      setSelectedHistoryIndex(null);
    }
  }, [selectedHistoryIndex]);

  return (
    <div className="w-full h-full min-h-0 flex flex-col rounded-lg overflow-hidden border border-border/50 bg-muted/30 shadow-inner surface-subtle">
      <div
        ref={historyContainerRef}
        data-e2e="mdi-history"
        className="flex-1 min-h-24 overflow-y-auto p-2 space-y-0.5 font-mono text-sm"
        style={{ scrollBehavior: 'smooth' }}
      >
        {history.length === 0 && (
          <div className="text-muted-foreground/70 text-xs py-2 px-1">
            {t('mdiConsole.emptyHistory')}
          </div>
        )}
        {history.map((item, idx) => (
          <button
            key={`${idx}-${item}`}
            type="button"
            onClick={() => handleHistoryClick(item)}
            aria-label={t('mdi.applyToLineAria')}
            className={cn(
              'w-full min-w-0 text-left px-2 py-1.5 rounded-none block border-b border-border/40 last:border-b-0',
              'hover:bg-white/15 focus:bg-white/15 focus:outline-none focus:ring-1 focus:ring-ring/50',
              'text-foreground/90 hover:text-foreground',
              idx === selectedHistoryIndex && 'bg-white/15 text-foreground',
            )}
          >
            <span className="block min-w-0 truncate">
              <GcodeHighlightedText
                text={item}
                plainInherit={idx === selectedHistoryIndex}
                gmHover
              />
            </span>
          </button>
        ))}
        <div ref={historyEndRef} />
      </div>

      <div className="h-px bg-border/50" />

      <MdiInputWithGmTooltip
        key={i18n.language}
        input={input}
        onInputChange={handleInputChange}
        inputRef={inputRef}
        isMdiDisabled={isMdiDisabled}
        preconditionTooltip={tooltip}
        onSubmit={handleSubmit}
        onKeyDown={handleInputKeyDown}
        onBlur={handleInputBlur}
      />
    </div>
  );
}
