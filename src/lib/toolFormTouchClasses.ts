import { mergeTouchSelectTrigger } from '@/components/ui/TouchSelectField';
import { cn } from '@/lib/utils';

/** Shared text field classes for tool dialogs (edit, info, …). */
export const toolFormInputClass = cn(
  'w-full rounded-md border border-input bg-background/80 px-3 py-2',
  'text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring',
);

/** Trigger for `TouchSelectField` as in the tool edit dialog. */
export const toolFormTouchSelectTriggerClass = mergeTouchSelectTrigger(toolFormInputClass);
