import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import {
  usePendingWsCommandResultMap,
  usePendingWsCommandResults,
} from '@/hooks/usePendingWsCommandResult';
import { formatProgramPathError } from '@/lib/formatProgramPathError';
import { cn } from '@/lib/utils';
import { ArrowLeft, FileText, FolderOpen, Loader2 } from 'lucide-react';

export type ProgramListEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
};

function parseListEntries(raw: unknown): ProgramListEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      const o = e as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      const path = typeof o.path === 'string' ? o.path : '';
      const isDir = o.isDir === true;
      const size = typeof o.size === 'number' ? o.size : null;
      if (!name || !path) return null;
      return { name, path, isDir, size };
    })
    .filter((x): x is ProgramListEntry => x !== null);
}

type ProgramFileBrowserDialogBase = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type ProgramFileBrowserDialogProps =
  | (ProgramFileBrowserDialogBase & {
      mode: 'load';
      onFileLoaded: (path: string, content: string) => void;
    })
  | (ProgramFileBrowserDialogBase & {
      mode: 'saveAs';
      onSaveAsConfirm: (fullPath: string) => void;
    });

export function ProgramFileBrowserDialog(props: ProgramFileBrowserDialogProps) {
  const { t } = useTranslation('components');
  const { open, onOpenChange, mode } = props;
  const onFileLoaded = mode === 'load' ? props.onFileLoaded : undefined;

  const sendCommand = useSendCommand();

  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProgramListEntry[]>([]);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

  const pendingListIdsRef = useRef<Set<string>>(new Set());
  const pendingReadIdsRef = useRef<Map<string, string>>(new Map());
  /** Visited directories (for “up one level” when `parentPath` is missing). */
  const dirStackRef = useRef<string[]>([]);
  const [, bumpNav] = useReducer((n: number) => n + 1, 0);

  const requestList = useCallback(
    (path?: string) => {
      const cmdId = generateCommandId();
      pendingListIdsRef.current.add(cmdId);
      setLoading(true);
      setBrowserError(null);
      sendCommand(
        'program',
        'list',
        path != null && path.length > 0 ? { path } : {},
        cmdId,
      );
    },
    [sendCommand],
  );

  useEffect(() => {
    if (!open) {
      setCurrentDir(null);
      setParentPath(null);
      setEntries([]);
      setBrowserError(null);
      setLoading(false);
      setSaveAsName('');
      pendingListIdsRef.current.clear();
      pendingReadIdsRef.current.clear();
      dirStackRef.current = [];
      bumpNav();
      return;
    }
    dirStackRef.current = [];
    bumpNav();
    requestList();
  }, [open, requestList]);

  usePendingWsCommandResults(pendingListIdsRef, {
    enabled: open,
    onResult: (cmdId, r) => {
      pendingListIdsRef.current.delete(cmdId);
      setLoading(false);
      if (r.ok && r.result) {
        const p = r.result.path;
        const pp = r.result.parentPath;
        if (typeof p === 'string' && p.length > 0) {
          setCurrentDir(p);
          setParentPath(typeof pp === 'string' && pp.length > 0 ? pp : null);
          setEntries(parseListEntries(r.result.entries));
          setBrowserError(null);
        } else {
          setBrowserError(t('fileBrowser.invalidListResponse'));
        }
      } else {
        const msg = formatProgramPathError(r.error, t('fileBrowser.loadDirFailed'), t);
        setBrowserError(msg);
      }
    },
  });

  usePendingWsCommandResultMap(pendingReadIdsRef, {
    enabled: open && mode === 'load' && onFileLoaded != null,
    onResult: (cmdId, targetPath, r) => {
      pendingReadIdsRef.current.delete(cmdId);
      setLoading(false);
      if (r.ok && r.result && typeof r.result.content === 'string' && onFileLoaded) {
        // `program.read` returns the logical path; `program.open` / save must use that same path
        // (symlinks under PROGRAM_PREFIX → realpath outside prefix else `outside_program_prefix`).
        onFileLoaded(targetPath, r.result.content);
        onOpenChange(false);
      } else {
        const msg = formatProgramPathError(r.error, t('fileBrowser.readFileFailed'), t);
        setBrowserError(msg);
      }
    },
  });

  const handleGoUp = () => {
    const stack = dirStackRef.current;
    if (stack.length > 0) {
      const prev = stack.pop();
      bumpNav();
      if (prev != null) {
        requestList(prev);
      }
      return;
    }
    if (parentPath != null) {
      requestList(parentPath);
    }
  };

  const canGoUp = dirStackRef.current.length > 0 || parentPath != null;

  const handleEntryClick = (e: ProgramListEntry) => {
    if (e.isDir) {
      if (currentDir != null) {
        dirStackRef.current.push(currentDir);
        bumpNav();
      }
      requestList(e.path);
      return;
    }
    if (mode === 'load') {
      const cmdId = generateCommandId();
      pendingReadIdsRef.current.set(cmdId, e.path);
      setLoading(true);
      setBrowserError(null);
      sendCommand('program', 'read', { path: e.path }, cmdId);
    } else {
      setSaveAsName(e.name);
    }
  };

  const handleSaveAsSubmit = () => {
    if (mode !== 'saveAs' || !currentDir) return;
    const name = saveAsName.trim();
    if (!name) {
      setBrowserError(t('fileBrowser.enterFileName'));
      return;
    }
    const sep = currentDir.includes('\\') ? '\\' : '/';
    const trimmedDir = currentDir.replace(/[/\\]+$/, '');
    const full = `${trimmedDir}${sep}${name}`;
    props.onSaveAsConfirm(full);
    onOpenChange(false);
  };

  const title = mode === 'load' ? t('fileBrowser.loadTitle') : t('fileBrowser.saveAsTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-lg">
        <div className="space-y-3">
          <div className="flex items-center gap-2 min-h-8">
            {canGoUp ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 shrink-0"
                disabled={loading}
                onClick={handleGoUp}
              >
                <ArrowLeft className="h-4 w-4" />
                {t('fileBrowser.parentDir')}
              </Button>
            ) : null}
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
            ) : null}
          </div>
          {currentDir ? (
            <AppTooltip content={currentDir} className="min-w-0">
              <p className="text-xs text-muted-foreground font-mono truncate">{currentDir}</p>
            </AppTooltip>
          ) : null}
          {browserError ? (
            <p className="text-sm text-destructive" role="alert">
              {browserError}
            </p>
          ) : null}
          <ul
            className={cn(
              'border border-border/60 rounded-md max-h-[50vh] overflow-y-auto',
              'divide-y divide-border/40 bg-background/40',
            )}
          >
            {entries.length === 0 && !loading ? (
              <li className="px-3 py-6 text-sm text-muted-foreground text-center">
                {t('fileBrowser.noEntries')}
              </li>
            ) : null}
            {entries.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleEntryClick(e)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
                    'hover:bg-muted/50 transition-colors',
                    loading && 'opacity-50 pointer-events-none',
                  )}
                >
                  {e.isDir ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-amber-500/90" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate flex-1">{e.name}</span>
                  {!e.isDir && e.size != null ? (
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {e.size} B
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {mode === 'saveAs' ? (
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground" htmlFor="program-save-as-name">
                {t('fileBrowser.fileName')}
              </label>
              <input
                id="program-save-as-name"
                type="text"
                value={saveAsName}
                onChange={(ev) => setSaveAsName(ev.target.value)}
                onKeyDown={(ev) => ev.key === 'Enter' && handleSaveAsSubmit()}
                placeholder={t('fileBrowser.fileNamePlaceholder')}
                className={cn(
                  'w-full rounded-md border border-input bg-background/80 px-3 py-2',
                  'text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('fileBrowser.cancel')}
          </Button>
          {mode === 'saveAs' ? (
            <Button type="button" variant="surface" onClick={handleSaveAsSubmit}>
              {t('fileBrowser.applyPath')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
