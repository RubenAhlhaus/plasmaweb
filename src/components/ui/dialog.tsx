import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/** Multiple open `DialogContent` instances share one lock (e.g. confirm over main modal). */
let dialogBodyScrollLockCount = 0;

function acquireDialogBodyScrollLock() {
  dialogBodyScrollLockCount += 1;
  if (dialogBodyScrollLockCount === 1) {
    document.body.style.overflow = 'hidden';
  }
}

function releaseDialogBodyScrollLock() {
  dialogBodyScrollLockCount = Math.max(0, dialogBodyScrollLockCount - 1);
  if (dialogBodyScrollLockCount === 0) {
    document.body.style.overflow = '';
  }
}

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error('Dialog components must be used within Dialog');
  return ctx;
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const value = React.useMemo(
    () => ({ open, onOpenChange }),
    [open, onOpenChange]
  );
  return (
    <DialogContext.Provider value={value}>
      {children}
    </DialogContext.Provider>
  );
}

interface DialogTriggerProps {
  asChild?: boolean;
  children: React.ReactNode;
}

function DialogTrigger({ asChild, children }: DialogTriggerProps) {
  const { onOpenChange } = useDialog();
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
      onClick: () => onOpenChange(true),
    });
  }
  return (
    <button type="button" onClick={() => onOpenChange(true)}>
      {children}
    </button>
  );
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  children: React.ReactNode;
  /** Return `false` to keep this dialog open on Escape (e.g. close nested modal first). */
  onEscapeKeyDown?: () => boolean | void;
  /** E.g. higher z-index when stacking modals (`z-[60]`). */
  overlayClassName?: string;
}

function DialogContent({
  title,
  children,
  className,
  onEscapeKeyDown,
  overlayClassName,
  ...props
}: DialogContentProps) {
  const { open, onOpenChange } = useDialog();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const allowClose = onEscapeKeyDown?.() !== false;
        if (!allowClose) return;
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    acquireDialogBodyScrollLock();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      releaseDialogBodyScrollLock();
    };
  }, [open, onOpenChange, onEscapeKeyDown]);

  if (!open) return null;

  const overlay = (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4',
        overlayClassName
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'dialog-title' : undefined}
        className={cn(
          'surface rounded-lg shadow-xl border border-border/50 p-6 max-h-[90vh] overflow-y-auto w-full max-w-md',
          className
        )}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {title && (
          <h2 id="dialog-title" className="text-xl font-semibold mb-4 text-foreground">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex justify-end gap-2 mt-6 pt-4 border-t border-border/50', className)}
      {...props}
    />
  );
}

export { Dialog, DialogTrigger, DialogContent, DialogFooter };
