import { cn } from '@/lib/utils';

export type ProgramQueueRootInsertSlotVariant = 'shift' | 'overlay';

type ProgramQueueRootInsertSlotProps = {
  show: boolean;
  /**
   * `shift` = make space (root drags from outside, intuitive).
   * `overlay` = glow line only, no height change — avoids collision↔layout loops when dragging out of a nested pattern block.
   */
  variant?: ProgramQueueRootInsertSlotVariant;
};

export function ProgramQueueRootInsertSlot({
  show,
  variant = 'shift',
}: ProgramQueueRootInsertSlotProps) {
  const bar = (
    <div
      className={cn(
        'rounded-lg border-2 border-dashed border-primary/60',
        'bg-primary/15 shadow-[0_0_22px_rgba(59,130,250,0.35)]',
        'ring-1 ring-inset ring-primary/25',
        variant === 'overlay' && 'h-3.5',
        variant === 'shift' && 'h-11'
      )}
    />
  );

  if (variant === 'overlay') {
    return (
      <div
        aria-hidden
        className="relative z-[2] h-0 w-full shrink-0 overflow-visible pointer-events-none"
      >
        <div
          className={cn(
            'absolute left-0 right-0 top-0 -translate-y-1/2 transition-opacity duration-150 ease-out',
            show ? 'opacity-100' : 'opacity-0'
          )}
        >
          {bar}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        'overflow-hidden transition-[max-height,opacity,margin] duration-200 ease-out',
        show ? 'max-h-12 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0 pointer-events-none'
      )}
    >
      {bar}
    </div>
  );
}
