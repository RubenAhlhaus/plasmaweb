import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ErrorToast() {
  const { t } = useTranslation('components');
  const toasts = useAppStore((s) => s.errorToasts);
  const dismiss = useAppStore((s) => s.dismissErrorToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[100] pointer-events-none">
      <div className="flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto surface-strong rounded-md border shadow-lg px-3 py-2 w-[min(520px,calc(100vw-2rem))]',
              toast.tone === 'info'
                ? 'border-emerald-500/35'
                : 'border-destructive/30',
            )}
            role={toast.tone === 'info' ? 'status' : 'alert'}
            aria-live={toast.tone === 'info' ? 'polite' : 'assertive'}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'font-semibold leading-tight',
                    toast.tone === 'info' ? 'text-emerald-200' : 'text-destructive',
                  )}
                >
                  {toast.tone === 'info' ? t('errorToast.noteTitle') : t('errorToast.errorTitle')}
                </div>
                <div className="text-foreground/90 text-sm break-words mt-0.5">{toast.message}</div>
                {toast.kind && <div className="text-muted-foreground text-xs mt-1">{toast.kind}</div>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => dismiss(toast.id)}
                className="h-7 w-7 -mr-2 text-foreground/70 hover:text-foreground"
                aria-label={
                  toast.tone === 'info' ? t('errorToast.dismissNote') : t('errorToast.dismissError')
                }
              >
                X
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

