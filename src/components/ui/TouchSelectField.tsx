import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TouchSelectOption = { value: string; label: string };

/** Shared layout for trigger alongside existing `inputClass` strings (touch targets, flex, font size). */
export const touchSelectTriggerLayoutClass =
  'flex min-h-14 items-center justify-between gap-2 text-left text-lg';

export function mergeTouchSelectTrigger(baseInputClass: string) {
  return cn(baseInputClass, touchSelectTriggerLayoutClass);
}

const defaultTriggerClass = cn(
  'flex w-full min-h-14 items-center justify-between gap-2 rounded-md border border-input bg-background/80 px-4 py-3 text-left text-lg',
  'text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
  'disabled:pointer-events-none disabled:opacity-50',
);

type PickerItem = { key: string; value: string; label: string };

type TouchSelectFieldProps = {
  /** For screen reader / dialog title; with `hideLabel` no visible field label above. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: TouchSelectOption[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  dialogTitle?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** When a parent section title replaces the label (e.g. coolant). */
  hideLabel?: boolean;
  /** Stable selector for E2E on picker `DialogContent`. */
  pickerDataE2e?: string;
  'data-e2e'?: string;
};

export function TouchSelectField({
  label,
  value,
  onChange,
  options,
  allowEmpty = false,
  emptyLabel = '–',
  dialogTitle,
  disabled: disabledProp = false,
  className,
  triggerClassName,
  hideLabel = false,
  pickerDataE2e,
  'data-e2e': dataE2e,
}: TouchSelectFieldProps) {
  const { t } = useTranslation('components');
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const listboxId = `${baseId}-listbox`;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const items: PickerItem[] = useMemo(() => {
    const list: PickerItem[] = [];
    if (allowEmpty) list.push({ key: '__empty', value: '', label: emptyLabel });
    options.forEach((o, i) => list.push({ key: `${o.value}::${i}`, value: o.value, label: o.label }));
    return list;
  }, [allowEmpty, emptyLabel, options]);

  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) {
      if (m.has(o.value) && import.meta.env.DEV) {
        console.warn('[TouchSelectField] duplicate option value:', o.value);
      }
      m.set(o.value, o.label);
    }
    return m;
  }, [options]);

  const displayLabel =
    value === '' && allowEmpty
      ? emptyLabel
      : (labelByValue.get(value) ?? (value === '' ? emptyLabel : value));

  const title = dialogTitle ?? label;

  const noChoices = !allowEmpty && options.length === 0;
  const disabled = disabledProp || noChoices;

  const focusOptionAt = useCallback((idx: number) => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    setFocusIndex(clamped);
    optionRefs.current[clamped]?.focus();
  }, [items.length]);

  useLayoutEffect(() => {
    if (!pickerOpen || items.length === 0) return;
    const idx = items.findIndex((it) => it.value === value);
    const i = idx >= 0 ? idx : 0;
    setFocusIndex(i);
    optionRefs.current[i]?.focus();
  }, [pickerOpen, items, value]);

  const handleOptionKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLButtonElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusOptionAt(index + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusOptionAt(index - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusOptionAt(0);
          break;
        case 'End':
          e.preventDefault();
          focusOptionAt(items.length - 1);
          break;
        default:
          break;
      }
    },
    [focusOptionAt, items.length],
  );

  return (
    <div className={cn(hideLabel ? undefined : 'space-y-1', className)}>
      {!hideLabel && (
        <label
          htmlFor={triggerId}
          className="block h-5 leading-5 text-sm text-muted-foreground whitespace-nowrap"
        >
          {label}
        </label>
      )}
      <button
        id={triggerId}
        type="button"
        disabled={disabled}
        title={noChoices ? t('touchSelect.noChoices') : undefined}
        data-e2e={dataE2e}
        aria-label={hideLabel ? label : undefined}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-controls={pickerOpen ? listboxId : undefined}
        className={cn(defaultTriggerClass, triggerClassName)}
        onClick={() => {
          if (!noChoices) setPickerOpen(true);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
        <ChevronDown className="size-6 shrink-0 opacity-60" aria-hidden />
      </button>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent
          title={title}
          className="max-w-lg"
          data-e2e={pickerDataE2e}
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label={title}
            className="flex max-h-[min(70vh,28rem)] flex-col gap-3 overflow-y-auto pr-1 outline-none"
          >
            {items.map((item, i) => (
              <Button
                key={item.key}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={value === item.value}
                tabIndex={focusIndex === i ? 0 : -1}
                variant={item.value === value ? 'secondary' : 'outline'}
                className="h-auto min-h-16 w-full justify-start px-5 py-4 text-lg font-normal"
                onFocus={() => setFocusIndex(i)}
                onKeyDown={(e) => handleOptionKeyDown(i, e)}
                onClick={() => {
                  onChange(item.value);
                  setPickerOpen(false);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
