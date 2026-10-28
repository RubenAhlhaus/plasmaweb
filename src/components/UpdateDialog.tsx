import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import {
  fetchUpdateInfo,
  fetchUpdateInstallStatus,
  persistSkippedUpdateVersion,
  readSkippedUpdateVersion,
  startUpdateInstall,
  type UpdateInfo,
  type UpdateInstallStatus,
} from '@/lib/updateApi';

const INSTALL_POLL_INTERVAL_MS = 1000;

type UpdateDialogProps = {
  info: UpdateInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Offers the newer release, installs it on request and says when LinuxCNC has to restart.
 *
 * The page keeps running on the files it already loaded while the install rewrites them, so
 * the dialog can follow the install to the end; what it must not do is reload, because the
 * new UI would then be talking to the old backend.
 */
export function UpdateDialog({ info, open, onOpenChange }: UpdateDialogProps) {
  const { t } = useTranslation('components');
  const [install, setInstall] = useState<UpdateInstallStatus | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const running = starting || install?.state === 'running';

  useEffect(() => {
    if (install?.state !== 'running') return;
    const timer = window.setInterval(() => {
      void fetchUpdateInstallStatus().then((status) => {
        if (status !== null) setInstall(status);
      });
    }, INSTALL_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [install?.state]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [install?.log.length]);

  const handleInstall = () => {
    setStarting(true);
    setStartError(null);
    void startUpdateInstall().then((result) => {
      setStarting(false);
      if (result.ok) {
        setInstall({ state: 'running', log: [] });
      } else {
        setStartError(result.message ?? t('update.startFailed'));
      }
    });
  };

  const handleSkip = () => {
    if (info.latestVersion !== null) persistSkippedUpdateVersion(info.latestVersion);
    onOpenChange(false);
  };

  // An install in progress is not something to wave away by tapping outside the dialog.
  const handleOpenChange = (next: boolean) => {
    if (!next && running) return;
    onOpenChange(next);
  };

  const finished = install?.state === 'succeeded' || install?.state === 'failed';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl" onEscapeKeyDown={() => !running}>
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            {install?.state === 'succeeded'
              ? t('update.installedTitle')
              : install?.state === 'failed'
                ? t('update.failedTitle')
                : t('update.title', { version: info.latestVersion })}
          </h2>

          {install === null && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('update.versions', {
                  current: info.installedVersion,
                  latest: info.latestVersion,
                })}
              </p>
              {info.releaseNotes && (
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  {info.releaseNotes}
                </pre>
              )}
              <p className="text-sm text-muted-foreground">{t('update.restartNote')}</p>
              {!info.canInstall && (
                <p className="text-sm text-amber-400" data-testid="update-not-permitted">
                  {t('update.notPermitted')}
                </p>
              )}
              {startError !== null && <p className="text-sm text-destructive">{startError}</p>}
            </>
          )}

          {install !== null && (
            <>
              <p className="text-sm text-muted-foreground">
                {install.state === 'succeeded'
                  ? t('update.installedBody', { version: info.latestVersion })
                  : install.state === 'failed'
                    ? t('update.failedBody')
                    : t('update.installing')}
              </p>
              <pre
                ref={logRef}
                className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground"
                data-testid="update-install-log"
              >
                {install.log.join('\n') || '…'}
              </pre>
            </>
          )}
        </div>

        <DialogFooter>
          {install === null && (
            <>
              <Button type="button" variant="ghost" onClick={handleSkip} disabled={running}>
                {t('update.skip')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={running}
              >
                {t('update.later')}
              </Button>
              <Button
                type="button"
                onClick={handleInstall}
                disabled={running || !info.canInstall}
                data-testid="update-install"
              >
                {t('update.install')}
              </Button>
            </>
          )}
          {finished && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('update.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks once per page load and prompts when a release the operator has not skipped is out. */
export function UpdateDialogHost() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchUpdateInfo().then((result) => {
      if (cancelled || result === null) return;
      if (!result.updateAvailable || result.latestVersion === readSkippedUpdateVersion()) return;
      setInfo(result);
      setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (info === null) return null;
  return <UpdateDialog info={info} open={open} onOpenChange={setOpen} />;
}
