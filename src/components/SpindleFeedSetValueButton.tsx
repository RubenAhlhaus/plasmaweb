import { useId, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getFriendlyCantSetNumericValueMessage,
  type MdiDisabledReasonKey,
} from '@/hooks/useMdiPreconditions';

/** Gleiche Mindesthöhe wie bei „Drehzahl/Vorschub setzen“ (auch für „Override anwenden“ im Dialog). */
export const spindleFeedSubmitTouchButtonClass =
  'w-full min-h-24 h-auto text-lg touch-manipulation py-5';

export function SpindleFeedSetValueButton({
  canMdi,
  valueOk,
  reasons,
  kind,
  invalidHint,
  onClick,
  children,
  variantWhenEnabled = 'secondary',
  dataE2e,
}: {
  canMdi: boolean;
  valueOk: boolean;
  reasons: MdiDisabledReasonKey[];
  kind: 'spindle' | 'feed';
  invalidHint: string;
  onClick: () => void;
  children: ReactNode;
  /** `default` = Primary (blau) bei aktivem, klickbarem Button; Standard bleibt `secondary`. */
  variantWhenEnabled?: 'default' | 'secondary';
  /** Optional für E2E (z. B. `tool-info-preset-apply`). */
  dataE2e?: string;
}) {
  const hintId = useId();
  const canSubmit = canMdi && valueOk;
  const blockTitle = !canSubmit
    ? !canMdi
      ? getFriendlyCantSetNumericValueMessage(reasons, kind) ?? undefined
      : !valueOk
        ? invalidHint
        : undefined
    : undefined;
  const describedBy = !canSubmit && blockTitle ? hintId : undefined;

  return (
    <div className={cn('w-full', !canSubmit && 'cursor-not-allowed')} title={blockTitle}>
      {!canSubmit && blockTitle ? (
        <span id={hintId} className="sr-only">
          {blockTitle}
        </span>
      ) : null}
      <Button
        type="button"
        variant={canSubmit && variantWhenEnabled === 'default' ? 'default' : 'secondary'}
        size="lg"
        className={cn(spindleFeedSubmitTouchButtonClass, !canSubmit && 'pointer-events-none')}
        disabled={!canSubmit}
        aria-describedby={describedBy}
        onClick={onClick}
        {...(dataE2e ? { 'data-e2e': dataE2e } : {})}
      >
        {children}
      </Button>
    </div>
  );
}
