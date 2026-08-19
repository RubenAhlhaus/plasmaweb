/** Shared layout for Home and Program (machine preview + right pane). */
/** Breakpoints align with Tailwind defaults: `xl` = 1280px. See `docs/frontend-web-start.md` → Responsive layout. */

import type { JogControlSize } from '@/lib/jogControlSize';
import { cn } from '@/lib/utils';

/** Single column below xl; two fluid columns at xl+ (~800 / ~696 ratio). */
export const machinePreviewGridClassName =
  'grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:grid-rows-1';

/** Preview column: cap height when stacked so jog + MDI keep room. */
export const machinePreviewColumnStackedClassName =
  'min-h-0 max-xl:max-h-[min(42vh,22rem)]';

/** Jog controls + MDI column (fills second grid row when stacked). */
export const homeRightColumnClassName =
  'flex h-full min-h-0 min-w-0 w-full flex-col gap-4 overflow-hidden xl:gap-6';

/** MDI wrapper — flex-1 within the right column. */
export const homeMdiContainerClassName = 'flex min-h-0 flex-1 flex-col';

/** Machine visualization cap when preview column is stacked. */
export const machineVisualizationStackedClassName =
  'min-h-0 flex-1 max-xl:max-h-[12rem] xl:max-h-none';

/** Increment selector + jog pad row. */
export function homeJogControlsRowClassName(size: JogControlSize): string {
  return cn(
    'flex min-w-0 shrink-0 items-center gap-3',
    size === 'full'
      ? 'flex-wrap items-start gap-x-6 gap-y-4'
      : 'flex-nowrap',
  );
}

/** Vertical offset for jog pad when beside increment selector on wide layouts. */
export function homeJogPadWrapperClassName(size: JogControlSize): string {
  return cn('shrink-0', size === 'full' && 'mt-4');
}
