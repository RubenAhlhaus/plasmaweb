import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { TOOL_DELETE_TOOL_TABLE_ROW_ACTION } from '@/api/toolTableCommands';
import { AppTooltip } from '@/components/AppTooltip';
import { TouchNumericDialogFooter } from '@/components/numeric/touchNumericDialog';
import { ToolEditDialog } from '@/components/tools/ToolEditDialog';
import { ToolTouchOffDialog } from '@/components/tools/ToolTouchOffDialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useMdiPreconditions } from '@/hooks/useMdiPreconditions';
import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { getToolIconSrc } from '@/lib/toolIcons';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { formatToolMaterialUi, type Tool } from '@/types/tools';

type ToolDetailsSidebarProps = {
  tool?: Tool;
  /** Selected tool is already in the spindle (T… / M6). */
  selectedToolIsActiveInSpindle?: boolean;
  /** Occupied LinuxCNC T numbers (duplicate check when renaming). */
  occupiedToolNumbers?: number[];
  onSuccessfulToolNumberChange?: (newToolId: string) => void;
};

/** Min height ~2× default button (h-10) for touch use */
const toolDetailsActionButtonClass =
  'w-full h-auto min-h-20 py-4 text-base touch-manipulation';

export function ToolDetailsSidebar({
  tool,
  selectedToolIsActiveInSpindle = false,
  occupiedToolNumbers = [],
  onSuccessfulToolNumberChange,
}: ToolDetailsSidebarProps) {
  const { t } = useTranslation('tools');
  const sendCommand = useSendCommand();
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const { canMdi, tooltip: mdiTooltip } = useMdiPreconditions();
  const [editOpen, setEditOpen] = useState(false);
  const [touchOffOpen, setTouchOffOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const pendingDeleteCommandIdRef = useRef<string | null>(null);

  usePendingWsCommandResult(pendingDeleteCommandIdRef, {
    onResult: (r) => {
      pendingDeleteCommandIdRef.current = null;
      setDeleteBusy(false);
      if (r.ok) {
        if (r.result?.toolTableReloadDeferred === true) {
          showErrorToast({
            tone: 'info',
            kind: t('toolDetails.toastToolTableKind'),
            message: t('toolDetails.toastReloadDeferred'),
          });
        }
        setDeleteConfirmOpen(false);
      }
    },
  });

  const handleConfirmDelete = useCallback(() => {
    if (!tool?.toolNumber || tool.toolNumber <= 0) return;
    if (connectionStatus !== 'connected') return;
    const commandId = generateCommandId();
    pendingDeleteCommandIdRef.current = commandId;
    setDeleteBusy(true);
    sendCommand('tool', TOOL_DELETE_TOOL_TABLE_ROW_ACTION, { toolno: tool.toolNumber }, commandId);
  }, [tool, connectionStatus, sendCommand]);

  const deleteDisabled =
    !tool ||
    connectionStatus !== 'connected' ||
    tool.toolNumber == null ||
    tool.toolNumber <= 0;

  const handleLoadToolToSpindle = useCallback(() => {
    if (!tool) return;
    if (selectedToolIsActiveInSpindle) return;
    const n = tool.toolNumber;
    if (n == null || n <= 0) return;
    if (connectionStatus !== 'connected' || !canMdi) return;
    sendCommand('program', 'mdi', { text: `T${n} M6 G43` });
  }, [tool, selectedToolIsActiveInSpindle, connectionStatus, canMdi, sendCommand]);

  const loadToolDisabled =
    !tool ||
    connectionStatus !== 'connected' ||
    !canMdi ||
    tool.toolNumber == null ||
    tool.toolNumber <= 0;

  const loadToolTitle = (() => {
    if (!tool || tool.toolNumber == null || tool.toolNumber <= 0) {
      return t('toolDetails.invalidToolNumber');
    }
    if (connectionStatus !== 'connected') return t('toolEdit.saveDisabledNoConnection');
    if (!canMdi && mdiTooltip) return mdiTooltip;
    return t('toolDetails.loadMdiTitle', { n: tool.toolNumber });
  })();

  const touchOffDisabled =
    !tool ||
    connectionStatus !== 'connected' ||
    !canMdi ||
    !selectedToolIsActiveInSpindle ||
    tool.toolNumber == null ||
    tool.toolNumber <= 0;

  const touchOffTitle = (() => {
    if (!tool || tool.toolNumber == null || tool.toolNumber <= 0) {
      return t('toolDetails.invalidToolNumber');
    }
    if (connectionStatus !== 'connected') return t('toolEdit.saveDisabledNoConnection');
    if (!canMdi && mdiTooltip) return mdiTooltip;
    if (!selectedToolIsActiveInSpindle) {
      return t('toolDetails.touchOffNeedSpindle');
    }
    return t('toolDetails.touchOffDescription');
  })();

  if (!tool) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <p className="text-sm text-muted-foreground py-4">{t('toolDetails.emptyHint')}</p>
      </div>
    );
  }

  const iconSrc = getToolIconSrc(tool);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('toolDetails.selectedHeading')}
      </div>
      <Card className="flex min-h-0 w-full flex-1 flex-col mb-4 p-4">
        <CardHeader className="shrink-0 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 flex items-center justify-center">
              <img
                src={iconSrc}
                alt={
                  tool.type
                    ? t('toolDetails.altWithType', { type: tool.type })
                    : t('toolDetails.altTool')
                }
                className="h-14 w-14 object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold leading-tight">{tool.name}</h3>
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                  'bg-primary/20 text-primary'
                )}
              >
                {tool.type ?? '–'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                  'bg-muted text-muted-foreground'
                )}
              >
                {formatToolMaterialUi(tool.material) || '–'}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('toolDetails.id')}</dt>
            <dd className="font-medium">{tool.id}</dd>
            <dt className="text-muted-foreground">{t('toolDetails.diameter')}</dt>
            <dd className="font-medium">
              {tool.diameter != null ? `${tool.diameter} mm` : '–'}
            </dd>
            <dt className="text-muted-foreground">{t('toolDetails.type')}</dt>
            <dd className="font-medium">{tool.type ?? '–'}</dd>
            <dt className="text-muted-foreground">{t('toolDetails.material')}</dt>
            <dd className="font-medium">{formatToolMaterialUi(tool.material) || '–'}</dd>
            <dt className="text-muted-foreground">{t('toolDetails.flutes')}</dt>
            <dd className="font-medium">
              {tool.numberOfFlutes != null ? tool.numberOfFlutes : '–'}
            </dd>
            <dt className="text-muted-foreground">{t('toolDetails.fluteLength')}</dt>
            <dd className="font-medium">
              {tool.flutesLength != null ? `${tool.flutesLength} mm` : '–'}
            </dd>
          </dl>
          {tool.comment && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                {t('toolDetails.comment')}
              </div>
              <p className="text-sm">{tool.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-shrink-0 flex-col gap-3" data-e2e="tool-details-actions">
        {selectedToolIsActiveInSpindle ? (
          <div
            role="status"
            className={cn(
              buttonVariants({ variant: 'default', size: 'default' }),
              toolDetailsActionButtonClass,
              'cursor-default select-none border-0 bg-emerald-600 text-emerald-50 shadow-none',
              'hover:bg-emerald-600 focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
          >
            {t('toolDetails.inSpindle')}
          </div>
        ) : (
          <>
            <AppTooltip content={loadToolTitle} className="block w-full">
              <Button
                className={toolDetailsActionButtonClass}
                disabled={loadToolDisabled}
                onClick={handleLoadToolToSpindle}
              >
                {t('toolDetails.loadTool')}
              </Button>
            </AppTooltip>
          </>
        )}
        <AppTooltip content={touchOffTitle} className="block w-full">
          <Button
            className={toolDetailsActionButtonClass}
            variant="outline"
            disabled={touchOffDisabled}
            onClick={() => setTouchOffOpen(true)}
          >
            {t('toolDetails.touchOff')}
          </Button>
        </AppTooltip>
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            className={toolDetailsActionButtonClass}
            disabled={connectionStatus !== 'connected'}
            onClick={() => setEditOpen(true)}
          >
            {t('toolDetails.edit')}
          </Button>
          <Button
            variant="outline"
            className={cn(
              toolDetailsActionButtonClass,
              'border-red-400/45 bg-red-500/10 text-red-100 hover:border-red-400/70 hover:bg-red-500/20 hover:text-white'
            )}
            disabled={deleteDisabled}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            {t('toolDetails.delete')}
          </Button>
        </div>
      </div>

      <ToolEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        tool={tool}
        mode="edit"
        occupiedToolNumbers={occupiedToolNumbers}
        onSuccessfulToolNumberChange={onSuccessfulToolNumberChange}
      />

      <ToolTouchOffDialog
        open={touchOffOpen}
        onOpenChange={setTouchOffOpen}
        toolSummary={tool ? `${tool.id} — ${tool.name}` : undefined}
      />

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(o) => {
          setDeleteConfirmOpen(o);
          if (!o) {
            pendingDeleteCommandIdRef.current = null;
            setDeleteBusy(false);
          }
        }}
      >
        <DialogContent title={t('toolDetails.deleteTitle')} className="max-w-md">
          <p className="text-sm text-muted-foreground">
            {t('toolDetails.deleteBody', { id: tool.id, name: tool.name })}
          </p>
          <TouchNumericDialogFooter
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={handleConfirmDelete}
            cancelLabel={t('toolEdit.cancel')}
            confirmLabel={t('toolDetails.delete')}
            confirmVariant="destructive"
            confirmDisabled={deleteDisabled || deleteBusy}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
