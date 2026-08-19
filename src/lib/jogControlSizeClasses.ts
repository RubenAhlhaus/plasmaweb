import type { JogControlSize } from '@/lib/jogControlSize';
import { cn } from '@/lib/utils';

const incrementShellBase =
  'inline-flex flex-col overflow-hidden rounded-lg border border-border/50 bg-muted/30 shadow-inner';

const incrementButtonBase = 'min-w-0 border-0 font-medium shadow-none';

/** Increment selector shell */
export function jogIncrementShellClassName(size: JogControlSize): string {
  return cn(incrementShellBase, size === 'full' ? 'h-80' : 'h-52');
}

export function jogIncrementButtonClassName(size: JogControlSize): string {
  return cn(
    incrementButtonBase,
    size === 'full' ? 'px-6 py-6 text-lg' : 'px-3 py-2 text-sm',
  );
}

/** DirectionalControl root row */
export function jogDirectionalRowClassName(size: JogControlSize): string {
  return cn('flex items-stretch', size === 'full' ? 'gap-5' : 'gap-3');
}

export function jogDirectionalPadClassName(size: JogControlSize): string {
  return cn(
    'relative flex shrink-0 items-center justify-center',
    size === 'full' ? 'h-[320px] w-[320px]' : 'h-[200px] w-[200px]',
  );
}

export function jogDirectionalCenterClassName(size: JogControlSize): string {
  return cn(
    'surface-strong rounded-full',
    size === 'full' ? 'h-16 w-16' : 'h-10 w-10',
  );
}

export function jogDirectionalButtonClassName(
  size: JogControlSize,
  options?: { continuousHold?: boolean },
): string {
  return cn(
    options?.continuousHold && 'touch-none select-none [-webkit-touch-callout:none]',
    size === 'full' ? 'h-24 w-24' : 'h-14 w-14',
  );
}

export function jogDirectionalIconClassName(size: JogControlSize): string {
  return size === 'full' ? 'h-10 w-10' : 'h-6 w-6';
}

export function jogDirectionalZColumnClassName(size: JogControlSize): string {
  return cn(
    'flex shrink-0 flex-col justify-between',
    size === 'full' ? 'h-[320px]' : 'h-[200px]',
  );
}
