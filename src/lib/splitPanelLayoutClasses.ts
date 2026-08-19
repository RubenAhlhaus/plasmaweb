/** Shared split-panel layout (main + side) for Tools, Macros, etc. */
/** Breakpoints align with Tailwind defaults: `lg` = 1024px. See `docs/frontend-web-start.md` → Responsive layout. */

/** Row container: stacks below lg, side-by-side at lg+. */
export const splitPanelRowClassName =
  'flex h-full min-h-0 flex-col gap-4 overflow-hidden lg:flex-row lg:gap-6';

/** Primary pane (table / macro tiles). */
export const splitPanelMainClassName = 'flex min-h-0 min-w-0 flex-1 flex-col';

/** Side pane (~420px max) for Tools detail column. */
export const splitPanelSideToolsClassName =
  'flex min-h-0 w-full max-h-[min(50vh,32rem)] shrink-0 flex-col overflow-y-auto border-border/40 border-t pt-4 lg:max-h-none lg:w-[min(26.25rem,35%)] lg:max-w-[26.25rem] lg:border-l lg:border-t-0 lg:pt-0 lg:pl-4';

/** Side pane (~28rem max) for Macros program queue. */
export const splitPanelSideMacrosClassName =
  'flex min-h-0 w-full max-h-[min(42vh,28rem)] shrink-0 flex-col overflow-hidden border-border/50 border-t pt-4 lg:max-h-none lg:w-[min(28rem,35%)] lg:max-w-[28rem] lg:border-l lg:border-t-0 lg:pt-0 lg:pl-6';
