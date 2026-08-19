import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { getFormattedProgramCodes } from '@/utils/formatProgramCodes';
import { lookupCodeReference } from '@/utils/linuxCncCodeReference';
import {
  GmCodeManualLink,
  GmCodeReferenceBody,
} from '@/components/GmCodeReferenceBody';
import { AppTooltip } from '@/components/AppTooltip';
import { Card } from './ui/card';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

/** Shared styles for clickable G/M code labels (chip list and related-code links). */
const programCodeChipButtonBaseClassName =
  'rounded px-1 py-0.5 font-mono tabular-nums text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:bg-muted/70 hover:decoration-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type DialogState = { kind: 'g' | 'm'; label: string } | null;

function CodeChip({
  kind,
  label,
  onSelect,
}: {
  kind: 'g' | 'm';
  label: string;
  onSelect: (kind: 'g' | 'm', label: string) => void;
}) {
  const ref = lookupCodeReference(kind, label);
  const hoverTitle = ref?.summary ?? ref?.title ?? label;

  return (
    <AppTooltip content={hoverTitle}>
      <button
        type="button"
        onClick={() => onSelect(kind, label)}
        className={cn('inline-flex items-center text-sm', programCodeChipButtonBaseClassName)}
      >
        {label}
      </button>
    </AppTooltip>
  );
}

function CodeRow({
  prefix,
  kind,
  codes,
  onSelectCode,
}: {
  prefix: string;
  kind: 'g' | 'm';
  codes: string[];
  onSelectCode: (kind: 'g' | 'm', label: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs font-semibold text-muted-foreground shrink-0 pt-0.5">
        {prefix}
      </span>
      <div className="flex flex-1 flex-wrap justify-end gap-x-2 gap-y-1 min-w-0">
        {codes.length > 0 ? (
          codes.map((code) => (
            <CodeChip key={code} kind={kind} label={code} onSelect={onSelectCode} />
          ))
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

export function ProgramCodesDisplay() {
  const program = useAppStore(
    useShallow((s) => ({
      gcodes: s.linuxCncStatus.program.gcodes,
      mcodes: s.linuxCncStatus.program.mcodes,
    })),
  );
  const { gCodes, mCodes } = getFormattedProgramCodes(program);
  const [dialog, setDialog] = useState<DialogState>(null);

  const hasAnyCodes = gCodes.length > 0 || mCodes.length > 0;

  const handleSelectCode = (kind: 'g' | 'm', label: string) => {
    setDialog({ kind, label });
  };

  const dialogRef = dialog ? lookupCodeReference(dialog.kind, dialog.label) : null;
  const dialogTitle = dialog
    ? `${dialog.label} — ${dialogRef?.title ?? 'No description in local reference'}`
    : '';

  return (
    <>
      <Card className="flex w-full max-w-[260px] min-w-0 flex-col px-4 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-muted-foreground">Active codes</span>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <CodeRow prefix="G" kind="g" codes={gCodes} onSelectCode={handleSelectCode} />
          <CodeRow prefix="M" kind="m" codes={mCodes} onSelectCode={handleSelectCode} />
        </div>
        {!hasAnyCodes && (
          <div className="mt-1 text-[10px] text-muted-foreground/70">
            No active G/M codes yet.
          </div>
        )}
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog && (
          <DialogContent title={dialogTitle} className="max-w-lg">
            <GmCodeReferenceBody
              kind={dialog.kind}
              label={dialog.label}
              onRelatedCodeSelect={handleSelectCode}
            />
            <DialogFooter>
              <GmCodeManualLink kind={dialog.kind} />
              <Button variant="default" size="sm" onClick={() => setDialog(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
