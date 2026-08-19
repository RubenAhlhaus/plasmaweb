import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { AppTooltip } from '@/components/AppTooltip';
import { Button } from '@/components/ui/button';
import { usePendingWsCommandResults } from '@/hooks/usePendingWsCommandResult';
import { COMMAND_RESPONSE_FALLBACK_MS } from '@/lib/commandFallbackMs';
import { formatMachineCoordinate } from '@/lib/formatCoordinates';
import { getToolIconSrc } from '@/lib/toolIcons';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import type { Tool } from '@/types/tools';
import { Plus, RefreshCw } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ToolsTableProps = {
  tools: Tool[];
  selectedToolId: string | null;
  /** ID des aktuell in der Maschine aktiven Werkzeugs (z. B. "T1"). */
  activeToolId?: string | null;
  onSelectTool: (id: string) => void;
  firstRowRef?: React.RefObject<HTMLButtonElement | null>;
  onAddTool?: () => void;
};

/** Spaltenlayout: Icon, ID, Pocket, X/Y/Z-Offsets, Name, Ø, Typ, Kommentar */
/** ID-Spalte fest (nicht `auto`): jede Zeile ist ein eigenes Grid — sonst rutscht die Zeile mit „Aktiv“-Badge. */
/** Badge unter der ID (nicht daneben), damit die Spalte schmal bleibt. */
const TOOLS_TABLE_GRID_CLASS =
  'grid grid-cols-[3rem_3.75rem_2.75rem_4.25rem_4.25rem_4.25rem_minmax(8rem,1.2fr)_3.5rem_7.25rem_minmax(6.5rem,1.45fr)] gap-2 sm:gap-3 px-3 sm:px-4';

function formatPocket(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return String(n);
}

/** Tool-Tabellen-Offsets in Maschineneinheiten (wie LinuxCNC `stat.tool_table`). */
function formatToolOffset(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return formatMachineCoordinate(n);
}

export function ToolsTable({
  tools,
  selectedToolId,
  activeToolId,
  onSelectTool,
  firstRowRef,
  onAddTool,
}: ToolsTableProps) {
  const { t } = useTranslation('tools');
  const sendCommand = useSendCommand();
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const [reloadBusy, setReloadBusy] = useState(false);
  const pendingLoadToolTableIdsRef = useRef<Set<string>>(new Set());
  const loadToolTableFallbackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  usePendingWsCommandResults(pendingLoadToolTableIdsRef, {
    onResult: (id) => {
      const timer = loadToolTableFallbackTimersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        loadToolTableFallbackTimersRef.current.delete(id);
      }
      pendingLoadToolTableIdsRef.current.delete(id);
      if (pendingLoadToolTableIdsRef.current.size === 0) {
        setReloadBusy(false);
      }
    },
  });

  useEffect(
    () => () => {
      for (const timer of loadToolTableFallbackTimersRef.current.values()) {
        clearTimeout(timer);
      }
      loadToolTableFallbackTimersRef.current.clear();
    },
    [],
  );

  const handleReloadToolTable = useCallback(() => {
    if (connectionStatus !== 'connected') return;
    const commandId = generateCommandId();
    pendingLoadToolTableIdsRef.current.add(commandId);
    setReloadBusy(true);
    sendCommand('program', 'load_tool_table', {}, commandId);
    const timer = setTimeout(() => {
      loadToolTableFallbackTimersRef.current.delete(commandId);
      if (pendingLoadToolTableIdsRef.current.delete(commandId)) {
        if (pendingLoadToolTableIdsRef.current.size === 0) {
          setReloadBusy(false);
        }
      }
    }, COMMAND_RESPONSE_FALLBACK_MS);
    loadToolTableFallbackTimersRef.current.set(commandId, timer);
  }, [connectionStatus, sendCommand]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    if (!tools.length) {
      return;
    }

    event.preventDefault();

    const currentIndex =
      selectedToolId != null ? tools.findIndex((tool) => tool.id === selectedToolId) : 0;
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const delta = event.key === 'ArrowDown' ? 1 : -1;

    let nextIndex = safeIndex + delta;

    if (nextIndex < 0) {
      nextIndex = tools.length - 1;
    } else if (nextIndex >= tools.length) {
      nextIndex = 0;
    }

    const nextTool = tools[nextIndex];
    if (nextTool) {
      onSelectTool(nextTool.id);
    }
  };

  const reloadDisabled = connectionStatus !== 'connected' || reloadBusy;
  const addDisabled = connectionStatus !== 'connected' || !onAddTool;

  return (
    <div className="flex flex-col h-full min-h-0 rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-2 py-1 border-b border-border/40 bg-muted/30">
        <AppTooltip content={t('table.addTooltip')}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 shrink-0 gap-1.5 border border-border/60 px-2 shadow-sm"
            disabled={addDisabled}
            onClick={onAddTool}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline text-xs font-medium">{t('table.addLabel')}</span>
          </Button>
        </AppTooltip>
        <AppTooltip content={t('table.reloadTooltip')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={reloadDisabled}
            onClick={handleReloadToolTable}
            aria-label={t('table.reloadAria')}
          >
            <RefreshCw className={cn('h-4 w-4', reloadBusy && 'animate-spin')} />
          </Button>
        </AppTooltip>
      </div>
      <div
        className={cn(
          'flex-shrink-0 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 bg-muted/40',
          TOOLS_TABLE_GRID_CLASS
        )}
      >
        <div className="min-w-0" />
        <div className="min-w-0">{t('table.headerId')}</div>
        <AppTooltip as="div" content={t('table.headerPktTooltip')} className="text-right tabular-nums">
          <div>{t('table.headerPkt')}</div>
        </AppTooltip>
        <AppTooltip as="div" content={t('table.headerXTooltip')} className="text-right tabular-nums">
          <div>X</div>
        </AppTooltip>
        <AppTooltip as="div" content={t('table.headerYTooltip')} className="text-right tabular-nums">
          <div>Y</div>
        </AppTooltip>
        <AppTooltip as="div" content={t('table.headerZTooltip')} className="text-right tabular-nums">
          <div>Z</div>
        </AppTooltip>
        <div className="min-w-0">{t('table.headerName')}</div>
        <AppTooltip as="div" content={t('table.headerDiameterTooltip')} className="text-right">
          <div>Ø</div>
        </AppTooltip>
        <div className="min-w-0">{t('table.headerType')}</div>
        <div className="min-w-0">{t('table.headerComment')}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {tools.map((tool) => {
          const isSelected = tool.id === selectedToolId;
          const isActive = tool.id === activeToolId;
          const iconSrc = getToolIconSrc(tool);

          return (
            <button
              key={tool.id}
              type="button"
              data-e2e="tools-table-row"
              data-tool-id={tool.id}
              ref={isSelected ? firstRowRef : undefined}
              onClick={() => onSelectTool(tool.id)}
              onFocus={() => onSelectTool(tool.id)}
              onKeyDown={handleKeyDown}
              className={cn(
                'w-full text-left text-sm transition-colors border-b border-border/30 last:border-b-0 min-h-[3rem]',
                TOOLS_TABLE_GRID_CLASS,
                'py-3 sm:py-4',
                'border-l-4 border-l-transparent hover:bg-muted/50 hover:border-l-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                isSelected && 'bg-primary/10 border-l-primary/70',
                isActive && 'border-l-emerald-500'
              )}
            >
              <span className="flex items-center justify-center">
                <img
                  src={iconSrc}
                  alt={
                    tool.type
                      ? t('toolDetails.altWithType', { type: tool.type })
                      : t('toolDetails.altTool')
                  }
                  className="h-6 w-6 object-contain"
                />
              </span>
              <span className="font-medium min-w-0 flex flex-col items-start justify-center gap-0.5">
                <span className="tabular-nums leading-none">{tool.id}</span>
                {isActive && (
                  <span className="inline-flex items-center rounded border border-emerald-500/70 bg-emerald-500/10 px-1 py-px text-[0.6rem] font-semibold uppercase leading-none tracking-wide text-emerald-600">
                    {t('table.activeBadge')}
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatPocket(tool.pocketNumber)}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatToolOffset(tool.offsetX)}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatToolOffset(tool.offsetY)}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatToolOffset(tool.offsetZ)}
              </span>
              <span className="truncate">{tool.name}</span>
              <span className="text-right tabular-nums">
                {tool.diameter != null ? tool.diameter : '–'}
              </span>
              <span className="truncate text-muted-foreground">{tool.type ?? '–'}</span>
              <span className="truncate text-muted-foreground">{tool.comment ?? '–'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
