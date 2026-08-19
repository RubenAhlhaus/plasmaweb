import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  TouchNumericDialogFooter,
  TouchNumericEntry,
  touchNumericDialogContentClassName,
} from '@/components/numeric';
import { trySubmitDialogFormOnEnter } from '@/lib/dialogFormSubmit';
import { cn } from '@/lib/utils';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import { formatMachineCoordinate } from '@/lib/formatCoordinates';
import { useAppStore } from '@/store';
import type { LinuxCncStatusRoot } from '@/store/types';
import { mapStatusToCoordinateSystems, type CoordinateAxisKey } from '@/api/coordinateSystems';
import { useSendCommand } from '@/api/backendCommands';

interface CoordinateSystemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openAxis?: CoordinateAxisKey | null;
  openAxisRequestId?: number;
}

export function CoordinateSystemsDialog({
  open,
  onOpenChange,
  openAxis = null,
  openAxisRequestId,
}: CoordinateSystemsDialogProps) {
  const { t } = useTranslation('components');
  const linuxCncStatus = useAppStore((s) => s.linuxCncStatus) as LinuxCncStatusRoot;
  const sendCommand = useSendCommand();

  const systems = useMemo(
    () => mapStatusToCoordinateSystems(linuxCncStatus),
    [linuxCncStatus],
  );

  const coordinateSystemLabel = useCallback(
    (sys: (typeof systems)[number]) =>
      sys.id === '0' ? t('coordinates.machineG53') : sys.label,
    [t],
  );

  const [axisDialog, setAxisDialog] = useState<CoordinateAxisKey | null>(null);
  const [axisInput, setAxisInput] = useState<string>('0.000');
  const [axisCommitError, setAxisCommitError] = useState<string | null>(null);
  const [axisDialogSessionKey, setAxisDialogSessionKey] = useState(0);

  const [offsetDialog, setOffsetDialog] = useState<{
    systemId: string;
    axis: CoordinateAxisKey;
    systemLabel: string;
  } | null>(null);
  const [offsetInput, setOffsetInput] = useState<string>('0.000');
  const [offsetCommitError, setOffsetCommitError] = useState<string | null>(null);
  const [offsetDialogSessionKey, setOffsetDialogSessionKey] = useState(0);

  const activeRowIndex = useMemo(() => {
    const i = systems.findIndex((s) => s.isActive);
    return i >= 0 ? i : 0;
  }, [systems]);

  const [keyboardRowIndex, setKeyboardRowIndex] = useState(0);
  const prevOpenRef = useRef(false);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const systemsRef = useRef(systems);
  systemsRef.current = systems;
  const keyboardRowIndexRef = useRef(keyboardRowIndex);
  keyboardRowIndexRef.current = keyboardRowIndex;

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setKeyboardRowIndex(activeRowIndex);
    }
    prevOpenRef.current = open;
  }, [open, activeRowIndex]);

  useEffect(() => {
    if (!open) return;
    setKeyboardRowIndex((i) => Math.max(0, Math.min(i, systems.length - 1)));
  }, [open, systems.length]);

  useEffect(() => {
    if (!open) return;
    rowRefs.current[keyboardRowIndex]?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [open, keyboardRowIndex]);

  const axisValueOk = useMemo(
    () => parseTouchNumericForCommit(axisInput) !== null,
    [axisInput],
  );

  const offsetValueOk = useMemo(
    () => parseTouchNumericForCommit(offsetInput) !== null,
    [offsetInput],
  );

  const handleSetActive = useCallback((systemId: string) => {
    sendCommand('motion', 'set_active_coordinate_system', { systemId });
  }, [sendCommand]);

  // Read coordinates only when opening via getState; depending on `coordinates` would reset input on every status tick.
  const handleOpenAxisDialog = useCallback((axis: CoordinateAxisKey) => {
    setOffsetDialog(null);
    const current = useAppStore.getState().coordinates[axis];
    const initial =
      typeof current === 'number' && Number.isFinite(current) ? formatMachineCoordinate(current) : '0.000';
    setAxisInput(initial);
    setAxisCommitError(null);
    setAxisDialogSessionKey((k) => k + 1);
    setAxisDialog(axis);
  }, []);

  const handleOpenOffsetDialog = useCallback(
    (systemId: string, axis: CoordinateAxisKey, display: string, systemLabel: string) => {
      setAxisDialog(null);
      const idx = systems.findIndex((s) => s.id === systemId);
      if (idx >= 0) setKeyboardRowIndex(idx);
      setOffsetInput(display);
      setOffsetCommitError(null);
      setOffsetDialogSessionKey((k) => k + 1);
      setOffsetDialog({ systemId, axis, systemLabel });
    },
    [systems],
  );

  const handleConfirmOffset = useCallback(() => {
    if (!offsetDialog) return;
    const { systemId, axis } = offsetDialog;
    const target = parseTouchNumericForCommit(offsetInput);
    if (target === null) {
      setOffsetCommitError(t('coordinates.invalidExpression'));
      return;
    }
    setOffsetCommitError(null);
    sendCommand('motion', 'set_coordinate_system_offset', {
      systemId,
      [axis]: target,
    });
    setOffsetDialog(null);
  }, [offsetDialog, offsetInput, sendCommand, t]);

  useEffect(() => {
    if (!open || !openAxis || openAxisRequestId == null) return;
    handleOpenAxisDialog(openAxis);
  }, [handleOpenAxisDialog, open, openAxis, openAxisRequestId]);

  const handleConfirmAxis = () => {
    if (!axisDialog) return;
    const axis = axisDialog;
    const target = parseTouchNumericForCommit(axisInput);
    if (target === null) {
      setAxisCommitError(t('coordinates.invalidExpression'));
      return;
    }
    setAxisCommitError(null);

    // Send only target value and axis; the backend computes the required offset from machine position.
    sendCommand('motion', 'set_axis_coordinate', {
      axis,
      value: target,
    });

    setAxisDialog(null);
  };

  /** Escape: close touch-numeric sub-dialogs first, then this dialog. */
  const handleMainDialogEscapeKey = useCallback((): boolean | void => {
    if (offsetDialog !== null) {
      setOffsetDialog(null);
      return false;
    }
    if (axisDialog !== null) {
      setAxisDialog(null);
      return false;
    }
  }, [offsetDialog, axisDialog]);

  /**
   * Arrow keys / Enter use a document capture listener: focus often stays on the element
   * behind the modal (e.g. coordinates display), so key events never pass through the
   * portaled dialog content in the capture/bubble path.
   */
  useEffect(() => {
    if (!open || axisDialog !== null || offsetDialog !== null) return;

    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') return;

      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest('input, textarea, [contenteditable="true"]')) return;

      const len = systemsRef.current.length;
      if (len === 0) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setKeyboardRowIndex((i) =>
          e.key === 'ArrowUp' ? (i - 1 + len) % len : (i + 1) % len,
        );
        return;
      }

      if (e.key === 'Enter') {
        if (target.closest('[data-skip-enter-row-activate]')) return;

        const offsetTrigger = target.closest('[data-coordinate-offset-trigger]');
        if (offsetTrigger instanceof HTMLButtonElement && !offsetTrigger.disabled) {
          const systemId = offsetTrigger.dataset.systemId;
          const axis = offsetTrigger.dataset.offsetAxis as CoordinateAxisKey | undefined;
          const display = offsetTrigger.dataset.offsetDisplay ?? '0.000';
          const systemLabel = offsetTrigger.dataset.systemLabel ?? '';
          if (systemId && axis) {
            e.preventDefault();
            e.stopPropagation();
            handleOpenOffsetDialog(systemId, axis, display, systemLabel);
          }
          return;
        }

        const aktivBtn = target.closest('[data-coordinate-aktiv-button]');
        if (aktivBtn instanceof HTMLButtonElement) {
          const systemId = aktivBtn.dataset.systemId;
          const highlighted = systemsRef.current[keyboardRowIndexRef.current];
          // Focus often stays on a cell button while arrow keys move the row highlight; only treat
          // Enter as "this Active button" when it matches the highlighted row.
          if (systemId && highlighted && systemId === highlighted.id) {
            e.preventDefault();
            e.stopPropagation();
            const rowIdx = systemsRef.current.findIndex((s) => s.id === systemId);
            if (rowIdx >= 0) setKeyboardRowIndex(rowIdx);
            const sys = systemsRef.current.find((s) => s.id === systemId);
            if (sys && !sys.isActive) {
              handleSetActive(systemId);
            }
            return;
          }
        }

        e.preventDefault();
        e.stopPropagation();
        const idx = keyboardRowIndexRef.current;
        const sys = systemsRef.current[idx];
        // G53 is non-modal in LinuxCNC (only with G0/G1); there is no "active machine CS" to select.
        if (sys && !sys.isActive && sys.id !== '0') {
          handleSetActive(sys.id);
        }
      }
    };

    document.addEventListener('keydown', onDocKeyDown, true);
    return () => document.removeEventListener('keydown', onDocKeyDown, true);
  }, [open, axisDialog, offsetDialog, handleSetActive, handleOpenOffsetDialog]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('coordinates.dialogTitle')}
        className="w-full max-w-4xl"
        onEscapeKeyDown={handleMainDialogEscapeKey}
      >
        <div className="text-xs text-muted-foreground mb-3">{t('coordinates.hint')}</div>
        <div className="border border-border/40 rounded-md overflow-hidden">
          {/* table-fixed + colgroup: aligned header/body columns; scroll wrapper + sticky thead */}
          <div
            className="max-h-[min(70vh,520px)] overflow-y-auto overflow-x-auto bg-background/80 [scrollbar-gutter:stable]"
          >
            <table className="w-full min-w-[36rem] table-fixed border-collapse text-base">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[19%]" />
                <col className="w-[19%]" />
                <col className="w-[19%]" />
                <col className="w-[19%]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-secondary/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th
                    scope="col"
                    className="border-b border-r border-border/40 px-3 py-4 text-left"
                  >
                    {t('coordinates.columnSystem')}
                  </th>
                  <th
                    scope="col"
                    className="border-b border-r border-border/40 px-3 py-4 text-right"
                  >
                    X
                  </th>
                  <th
                    scope="col"
                    className="border-b border-r border-border/40 px-3 py-4 text-right"
                  >
                    Y
                  </th>
                  <th
                    scope="col"
                    className="border-b border-r border-border/40 px-3 py-4 text-right"
                  >
                    Z
                  </th>
                  <th scope="col" className="border-b border-border/40 px-3 py-4 text-center">
                    {t('coordinates.columnActive')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {systems.map((sys, rowIndex) => {
                  const isMachine = sys.id === '0';
                  const isActive = sys.isActive;
                  const isKeyboardRow = rowIndex === keyboardRowIndex;
                  return (
                    <tr
                      key={sys.id}
                      ref={(el) => {
                        rowRefs.current[rowIndex] = el;
                      }}
                      className={cn(
                        'border-t border-border/30',
                        isActive ? 'bg-primary/10' : 'bg-background/60',
                        isKeyboardRow &&
                          'z-[1] ring-4 ring-inset ring-primary/80 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]',
                      )}
                    >
                      <td
                        className={cn(
                          'border-r border-border/40 p-0 font-mono',
                          isKeyboardRow && !isActive && 'bg-muted/55',
                        )}
                      >
                        <div
                          className={cn(
                            'flex min-h-20 w-full items-center px-3 text-base leading-tight',
                            isActive
                              ? 'bg-primary text-black'
                              : isKeyboardRow
                                ? 'bg-transparent text-muted-foreground'
                                : 'bg-muted/80 text-muted-foreground',
                          )}
                        >
                          {coordinateSystemLabel(sys)}
                        </div>
                      </td>
                      {(['x', 'y', 'z'] as CoordinateAxisKey[]).map((axis) => {
                        const raw = sys.offsets[axis];
                        const value = typeof raw === 'number' ? raw : 0;
                        const display = Number.isFinite(value) ? formatMachineCoordinate(value) : '0.000';
                        const disabled = isMachine;
                        return (
                          <td
                            key={axis}
                            className={cn(
                              'border-r border-border/40 p-0',
                              isKeyboardRow && !isActive && 'bg-muted/55',
                            )}
                          >
                            <button
                              type="button"
                              disabled={disabled}
                              data-coordinate-offset-trigger
                              data-system-id={sys.id}
                              data-offset-axis={axis}
                              data-offset-display={display}
                              data-system-label={coordinateSystemLabel(sys)}
                              onClick={() =>
                                handleOpenOffsetDialog(
                                  sys.id,
                                  axis,
                                  display,
                                  coordinateSystemLabel(sys),
                                )
                              }
                              className={cn(
                                'flex min-h-20 w-full items-center justify-end rounded-none border-0 px-3',
                                'text-right text-lg font-mono tabular-nums text-foreground touch-manipulation',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                                disabled
                                  ? 'cursor-not-allowed bg-background opacity-60 hover:bg-background'
                                  : isKeyboardRow && !isActive
                                    ? 'bg-transparent hover:bg-muted/50'
                                    : 'bg-background hover:bg-muted/40',
                              )}
                            >
                              {display}
                            </button>
                          </td>
                        );
                      })}
                      <td
                        className={cn('p-0', isKeyboardRow && !isActive && 'bg-muted/55')}
                        aria-label={
                          isMachine && !isActive ? t('coordinates.noActivateMachine') : undefined
                        }
                      >
                        {isMachine ? (
                          isActive ? (
                            <div
                              className={cn(
                                'flex min-h-20 w-full items-center justify-center rounded-none border-0 px-3 text-base font-semibold',
                                'cursor-default bg-primary text-black',
                              )}
                            >
                              {t('coordinates.stateActive')}
                            </div>
                          ) : (
                            <div
                              className="flex min-h-20 w-full items-center justify-center px-3"
                              aria-hidden
                            />
                          )
                        ) : (
                          <button
                            type="button"
                            data-coordinate-aktiv-button
                            data-system-id={sys.id}
                            onClick={() => {
                              setKeyboardRowIndex(rowIndex);
                              if (!isActive) handleSetActive(sys.id);
                            }}
                            className={cn(
                              'flex min-h-20 w-full items-center justify-center rounded-none border-0 px-3 text-base font-semibold transition-colors touch-manipulation',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                              isActive
                                ? 'cursor-default bg-primary text-black'
                                : isKeyboardRow
                                  ? 'bg-transparent text-foreground hover:bg-muted/60'
                                  : 'bg-background text-foreground hover:bg-muted/80',
                            )}
                          >
                            {isActive ? t('coordinates.stateActive') : t('coordinates.setActive')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div
          className="mt-4 flex flex-wrap justify-end gap-3"
          data-skip-enter-row-activate
        >
          <Button
            variant="surface"
            size="lg"
            className="min-h-14 min-w-[11rem] touch-manipulation px-6 text-base"
            onClick={() => handleOpenAxisDialog('x')}
          >
            {t('coordinates.setAxisX')}
          </Button>
          <Button
            variant="surface"
            size="lg"
            className="min-h-14 min-w-[11rem] touch-manipulation px-6 text-base"
            onClick={() => handleOpenAxisDialog('y')}
          >
            {t('coordinates.setAxisY')}
          </Button>
          <Button
            variant="surface"
            size="lg"
            className="min-h-14 min-w-[11rem] touch-manipulation px-6 text-base"
            onClick={() => handleOpenAxisDialog('z')}
          >
            {t('coordinates.setAxisZ')}
          </Button>
        </div>
        <DialogFooter className="gap-3" data-skip-enter-row-activate>
          <Button
            variant="ghost"
            size="lg"
            className="min-h-14 touch-manipulation px-8 text-base"
            onClick={() => onOpenChange(false)}
          >
            {t('coordinates.close')}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={axisDialog !== null} onOpenChange={(o) => !o && setAxisDialog(null)}>
        <DialogContent
          title={
            axisDialog
              ? t('coordinates.axisDialogTitle', { axis: axisDialog.toUpperCase() })
              : t('coordinates.axisDialogTitleFallback')
          }
          className={touchNumericDialogContentClassName}
          onKeyDown={(e) => trySubmitDialogFormOnEnter(e, axisValueOk, handleConfirmAxis)}
        >
          <TouchNumericEntry
            value={axisInput}
            onChange={(v) => {
              setAxisInput(v);
              setAxisCommitError(null);
            }}
            label={t('coordinates.axisTargetLabel', {
              axis: axisDialog?.toUpperCase() ?? '',
            })}
            keypadMode="always"
            showPreview
            layoutSize="touch"
            keyboardDecimalOnly
            errorText={axisCommitError ?? undefined}
            data-e2e="axis-coordinate-input"
            focusSelectSessionKey={axisDialog !== null ? axisDialogSessionKey : undefined}
          />
          <TouchNumericDialogFooter
            onCancel={() => setAxisDialog(null)}
            onConfirm={handleConfirmAxis}
            cancelLabel={t('coordinates.cancel')}
            confirmLabel={t('coordinates.confirm')}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={offsetDialog !== null} onOpenChange={(o) => !o && setOffsetDialog(null)}>
        <DialogContent
          title={
            offsetDialog
              ? t('coordinates.offsetDialogTitle', {
                  system: offsetDialog.systemLabel,
                  axis: offsetDialog.axis.toUpperCase(),
                })
              : t('coordinates.offsetDialogTitleFallback')
          }
          className={touchNumericDialogContentClassName}
          onKeyDown={(e) => trySubmitDialogFormOnEnter(e, offsetValueOk, handleConfirmOffset)}
        >
          <TouchNumericEntry
            value={offsetInput}
            onChange={(v) => {
              setOffsetInput(v);
              setOffsetCommitError(null);
            }}
            label={t('coordinates.offsetFieldLabel', {
              axis: offsetDialog?.axis.toUpperCase() ?? '',
            })}
            keypadMode="always"
            showPreview
            layoutSize="touch"
            keyboardDecimalOnly
            errorText={offsetCommitError ?? undefined}
            data-e2e="coordinate-system-offset-input"
            focusSelectSessionKey={offsetDialog !== null ? offsetDialogSessionKey : undefined}
          />
          <TouchNumericDialogFooter
            onCancel={() => setOffsetDialog(null)}
            onConfirm={handleConfirmOffset}
            cancelLabel={t('coordinates.cancel')}
            confirmLabel={t('coordinates.confirm')}
          />
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

