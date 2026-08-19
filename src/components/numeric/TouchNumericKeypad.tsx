import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const keyClassSizes = {
  default:
    'min-h-[3.5rem] min-w-[3.5rem] w-full text-xl font-semibold touch-manipulation shrink-0',
  touch:
    'min-h-[4.75rem] min-w-0 w-full text-2xl font-semibold touch-manipulation shrink-0',
} as const;

type TouchNumericKeyProps = {
  label: ReactNode;
  ariaLabel: string;
  onClick: () => void;
  className?: string;
};

function TouchNumericKey({
  label,
  ariaLabel,
  onClick,
  className: extra,
  keySize,
}: TouchNumericKeyProps & { keySize: keyof typeof keyClassSizes }) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(keyClassSizes[keySize], extra)}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

type TouchNumericKeypadProps = {
  onInsert: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  /** Evaluate expression and apply number to input (if valid). */
  onEquals: () => void;
  className?: string;
  /** No decimal separator (integer-only via pad). */
  integerOnly?: boolean;
  /** Larger keys and spacing for touch. */
  size?: 'default' | 'touch';
};

function TouchNumericKeypadComponent({
  onInsert,
  onBackspace,
  onClear,
  onEquals,
  className,
  integerOnly = false,
  size = 'default',
}: TouchNumericKeypadProps) {
  const { t } = useTranslation('components');
  const keySize = size;
  const gridClass =
    size === 'touch'
      ? 'grid grid-cols-4 gap-3 w-full max-w-none mx-auto'
      : 'grid grid-cols-4 gap-2 w-full max-w-md mx-auto';

  return (
    <div className={cn(gridClass, className)} role="group" aria-label={t('touchNumericKeypad.groupAria')}>
      <TouchNumericKey
        keySize={keySize}
        label="("
        ariaLabel={t('touchNumericKeypad.openParen')}
        onClick={() => onInsert('(')}
      />
      <TouchNumericKey
        keySize={keySize}
        label=")"
        ariaLabel={t('touchNumericKeypad.closeParen')}
        onClick={() => onInsert(')')}
      />
      <TouchNumericKey
        keySize={keySize}
        label="C"
        ariaLabel={t('touchNumericKeypad.clearAll')}
        className="text-destructive border-destructive/40"
        onClick={onClear}
      />
      <TouchNumericKey
        keySize={keySize}
        label="⌫"
        ariaLabel={t('touchNumericKeypad.backspace')}
        onClick={onBackspace}
      />

      <TouchNumericKey keySize={keySize} label="7" ariaLabel="7" onClick={() => onInsert('7')} />
      <TouchNumericKey keySize={keySize} label="8" ariaLabel="8" onClick={() => onInsert('8')} />
      <TouchNumericKey keySize={keySize} label="9" ariaLabel="9" onClick={() => onInsert('9')} />
      <TouchNumericKey
        keySize={keySize}
        label="÷"
        ariaLabel={t('touchNumericKeypad.divide')}
        onClick={() => onInsert('/')}
      />

      <TouchNumericKey keySize={keySize} label="4" ariaLabel="4" onClick={() => onInsert('4')} />
      <TouchNumericKey keySize={keySize} label="5" ariaLabel="5" onClick={() => onInsert('5')} />
      <TouchNumericKey keySize={keySize} label="6" ariaLabel="6" onClick={() => onInsert('6')} />
      <TouchNumericKey
        keySize={keySize}
        label="×"
        ariaLabel={t('touchNumericKeypad.multiply')}
        onClick={() => onInsert('*')}
      />

      <TouchNumericKey keySize={keySize} label="1" ariaLabel="1" onClick={() => onInsert('1')} />
      <TouchNumericKey keySize={keySize} label="2" ariaLabel="2" onClick={() => onInsert('2')} />
      <TouchNumericKey keySize={keySize} label="3" ariaLabel="3" onClick={() => onInsert('3')} />
      <TouchNumericKey
        keySize={keySize}
        label="−"
        ariaLabel={t('touchNumericKeypad.minus')}
        onClick={() => onInsert('-')}
      />

      {integerOnly ? null : (
        <TouchNumericKey
          keySize={keySize}
          label="."
          ariaLabel={t('touchNumericKeypad.decimal')}
          onClick={() => onInsert('.')}
        />
      )}
      <TouchNumericKey
        keySize={keySize}
        label="0"
        ariaLabel="0"
        className={integerOnly ? 'col-span-2' : undefined}
        onClick={() => onInsert('0')}
      />
      <TouchNumericKey
        keySize={keySize}
        label="="
        ariaLabel={t('touchNumericKeypad.calculate')}
        className="bg-primary/15"
        onClick={onEquals}
      />
      <TouchNumericKey
        keySize={keySize}
        label="+"
        ariaLabel={t('touchNumericKeypad.plus')}
        onClick={() => onInsert('+')}
      />
    </div>
  );
}

export const TouchNumericKeypad = memo(TouchNumericKeypadComponent);
