import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { evaluateNumericExpression } from '@/lib/evaluateNumericExpression';
import { TouchNumericKeypad } from '@/components/numeric/TouchNumericKeypad';

/**
 * Only characters {@link evaluateNumericExpression} handles (digits, + − * /, parens,
 * comma/dot as decimal separator, spaces). Letters and other chars are stripped.
 */
const NUMERIC_EXPRESSION_INPUT_STRIP = /[^0-9+\-*/().,\s]/g;

function sanitizeNumericExpressionKeyboardInput(raw: string): string {
  return raw.replace(NUMERIC_EXPRESSION_INPUT_STRIP, '');
}

/** Keyboard: sign, digits, one decimal separator (comma or dot) only; no operators. */
function sanitizeDecimalNumberKeyboardInput(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^-?[0-9]*[.,]?[0-9]*/);
  return m?.[0] ?? '';
}

const displayInputClasses = {
  default: cn(
    'w-full rounded-lg border-2 border-input bg-background px-4 py-4',
    'text-right text-3xl font-mono tabular-nums text-foreground',
    'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary',
    'min-h-[3.75rem] touch-manipulation',
  ),
  touch: cn(
    'w-full rounded-xl border-2 border-input bg-background px-5 py-6',
    'text-right text-4xl font-mono tabular-nums text-foreground',
    'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary',
    'min-h-[5rem] touch-manipulation',
  ),
} as const;

export type TouchNumericEntryProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  /** Live “= result” preview under field — only when keypad is shown */
  showPreview?: boolean;
  /** `focus`: pad only when focused; `always`: pad always visible */
  keypadMode?: 'always' | 'focus';
  /** Allow physical keyboard input (else pad only) */
  allowKeyboard?: boolean;
  /** No decimals; “=” rounds to integer (S/F dialogs). */
  integerOnly?: boolean;
  /** Larger input and keypad for touch monitors. */
  layoutSize?: 'default' | 'touch';
  className?: string;
  errorText?: string;
  'data-e2e'?: string;
  /**
   * When this increments (e.g. dialog reopened), focus input and select all — keyboard ready,
   * first key replaces value. First pad key also replaces, then normal append.
   */
  focusSelectSessionKey?: number;
  /**
   * Physical keyboard: decimal only (optional leading minus); operators like + * / ignored.
   * Keypad unchanged (expressions still via pad and “=”).
   */
  keyboardDecimalOnly?: boolean;
};

export function TouchNumericEntry({
  value,
  onChange,
  id: idProp,
  label,
  showPreview = true,
  keypadMode = 'always',
  allowKeyboard = true,
  integerOnly = false,
  layoutSize = 'default',
  className,
  errorText,
  'data-e2e': dataE2e,
  focusSelectSessionKey,
  keyboardDecimalOnly = false,
}: TouchNumericEntryProps) {
  const genId = useId();
  const inputId = idProp ?? genId;
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceNextKeypadInsertRef = useRef(false);
  const [focused, setFocused] = useState(false);

  const showKeypad = keypadMode === 'always' || focused;

  const showPreviewRow = showPreview && showKeypad;

  useEffect(() => {
    if (focusSelectSessionKey === undefined) return;
    replaceNextKeypadInsertRef.current = true;
    const id = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el || !allowKeyboard) return;
      el.focus();
      el.select();
    }, 0);
    return () => clearTimeout(id);
  }, [focusSelectSessionKey, allowKeyboard]);

  const preview = useMemo(() => {
    if (!showPreview) return null;
    const t = value.trim();
    if (!t) return null;
    const r = evaluateNumericExpression(t);
    if (r === null) return null;
    if (integerOnly) return String(Math.round(r));
    return String(r);
  }, [value, showPreview, integerOnly]);

  const handleInsert = useCallback(
    (ch: string) => {
      if (integerOnly && (ch === '.' || ch === ',')) return;
      if (replaceNextKeypadInsertRef.current) {
        replaceNextKeypadInsertRef.current = false;
        onChange(ch);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el && allowKeyboard) {
            el.focus();
            const len = ch.length;
            el.setSelectionRange(len, len);
          }
        });
        return;
      }
      onChange(value + ch);
    },
    [allowKeyboard, integerOnly, onChange, value],
  );

  const handleBackspace = useCallback(() => {
    replaceNextKeypadInsertRef.current = false;
    onChange(value.slice(0, -1));
  }, [onChange, value]);

  const handleClear = useCallback(() => {
    replaceNextKeypadInsertRef.current = false;
    onChange('');
  }, [onChange]);

  const handleEquals = useCallback(() => {
    replaceNextKeypadInsertRef.current = false;
    const r = evaluateNumericExpression(value);
    if (r === null) return;
    onChange(integerOnly ? String(Math.round(r)) : String(r));
  }, [integerOnly, onChange, value]);

  return (
    <div className={cn('space-y-3', className)}>
      {label ? (
        <label
          htmlFor={inputId}
          className={cn(
            'font-medium text-muted-foreground',
            layoutSize === 'touch' ? 'text-base' : 'text-sm',
          )}
        >
          {label}
        </label>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode={allowKeyboard ? (keyboardDecimalOnly ? 'decimal' : 'text') : 'none'}
        readOnly={!allowKeyboard}
        autoComplete="off"
        spellCheck={false}
        data-e2e={dataE2e}
        aria-invalid={Boolean(errorText)}
        aria-describedby={
          errorText
            ? `${inputId}-error`
            : showPreviewRow && preview !== null
              ? `${inputId}-preview`
              : undefined
        }
        className={displayInputClasses[layoutSize]}
        value={value}
        onChange={
          allowKeyboard
            ? (e) => {
                replaceNextKeypadInsertRef.current = false;
                onChange(
                  keyboardDecimalOnly
                    ? sanitizeDecimalNumberKeyboardInput(e.target.value)
                    : sanitizeNumericExpressionKeyboardInput(e.target.value),
                );
              }
            : undefined
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {showPreviewRow ? (
        <p
          id={`${inputId}-preview`}
          className={cn(
            'text-right font-mono tabular-nums text-muted-foreground leading-normal',
            layoutSize === 'touch' ? 'min-h-[2rem] text-xl' : 'min-h-[1.75rem] text-lg',
          )}
          aria-live="polite"
        >
          {preview !== null ? `= ${preview}` : null}
        </p>
      ) : null}
      {errorText ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      ) : null}
      {showKeypad ? (
        <TouchNumericKeypad
          onInsert={handleInsert}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onEquals={handleEquals}
          integerOnly={integerOnly}
          size={layoutSize === 'touch' ? 'touch' : 'default'}
        />
      ) : null}
    </div>
  );
}
