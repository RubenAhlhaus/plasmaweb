import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { useAppStore } from '@/store';

type UserButton = {
  number: number;
  name: string;
  code: string;
  kind: string;
  params: Record<string, unknown>;
  supported: boolean;
  reason: string | null;
};

/** Codes that act while held, so the release matters as much as the press. */
const MOMENTARY = new Set(['torch-pulse', 'ohmic-test']);

/**
 * The machine's own buttons, defined in its prefs file.
 *
 * The list comes from the backend, which read the file: this panel never knows what a button
 * does, only what it is called and whether the machine can run it. A button the backend cannot
 * run is shown disabled with its reason, because a shop that configured one deserves to know
 * why it does nothing rather than to find out mid-job.
 */
export function UserButtonPanel() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const available = useAppStore((s) => s.plasmaAvailable);

  const [buttons, setButtons] = useState<UserButton[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const listRef = useRef<string | null>(null);
  const pressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!available || buttons) return;
    const commandId = commands.userButtons();
    if (commandId) listRef.current = commandId;
  }, [available, buttons, commands]);

  usePendingWsCommandResult(listRef, {
    onResult: (result) => {
      listRef.current = null;
      if (result.ok && result.result) {
        setButtons(((result.result as { buttons?: UserButton[] }).buttons ?? []) as UserButton[]);
      }
    },
  });

  usePendingWsCommandResult(pressRef, {
    onResult: (result) => {
      pressRef.current = null;
      if (!result.ok) {
        setMessage(result.error?.message ?? result.error?.code ?? null);
      }
    },
  });

  const press = (button: UserButton, pressed: boolean) => {
    const commandId = commands.userButton(button.number, pressed);
    if (commandId && pressed) {
      pressRef.current = commandId;
      setMessage(null);
    }
  };

  if (!buttons || buttons.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-e2e="plasma-user-buttons">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('userButtons.title')}
      </span>
      <div className="grid grid-cols-2 gap-1">
        {buttons.map((button) => (
          <button
            key={button.number}
            type="button"
            data-e2e={`plasma-user-button-${button.number}`}
            className="min-h-[3rem] whitespace-pre-line rounded-md border border-white/10 bg-slate-900/60 px-2 py-2 text-xs font-semibold uppercase leading-tight tracking-wide hover:border-white/25 disabled:opacity-30"
            disabled={!button.supported}
            title={button.supported ? button.code : button.reason ?? undefined}
            onPointerDown={() => (MOMENTARY.has(button.kind) ? press(button, true) : undefined)}
            onPointerUp={() => (MOMENTARY.has(button.kind) ? press(button, false) : undefined)}
            onPointerLeave={() => (MOMENTARY.has(button.kind) ? press(button, false) : undefined)}
            onClick={() => (MOMENTARY.has(button.kind) ? undefined : press(button, true))}
          >
            {button.name}
          </button>
        ))}
      </div>
      {message && (
        <span className="text-xs text-amber-300" data-e2e="plasma-user-buttons-message">
          {message}
        </span>
      )}
    </div>
  );
}
