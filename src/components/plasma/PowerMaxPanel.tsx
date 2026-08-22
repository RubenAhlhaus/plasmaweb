import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';

interface PowerMaxStatus {
  enabled: boolean;
  connected: boolean;
  port: string;
  mode: number;
  current: number;
  currentMin: number;
  currentMax: number;
  pressure: number;
  pressureMin: number;
  pressureMax: number;
  pressureUnit: string;
  arcTime: number;
  fault: { raw: string; code: string; name: string } | null;
  setpoints?: { cutMode?: number; cutAmps?: number; gasPressure?: number };
}

const buttonClass =
  'rounded-md border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:border-white/25 disabled:opacity-40';

/** Arc-on time comes from the supply in seconds; an operator reads it as hours. */
function hms(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * A Hypertherm PowerMax over RS485: what it is doing, and its faults by name.
 *
 * The supply's cut mode, current and gas pressure come from the *material*, not from this
 * panel — that is the point of the link, and it is why there is nothing to type here. What the
 * panel is for is the other direction: whether comms are up, what the supply is reporting back,
 * and which fault it is complaining about, because a fault code without its name means a trip
 * to the manual with the torch still hot.
 *
 * Hidden entirely on a machine with no port configured, which is most of them.
 */
export function PowerMaxPanel() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();

  const [status, setStatus] = useState<PowerMaxStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const statusRef = useRef<string | null>(null);
  const enableRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    const commandId = commands.powermaxStatus();
    if (commandId) statusRef.current = commandId;
  }, [commands]);

  useEffect(() => {
    refresh();
    // Polled rather than streamed: the supply's readings change slowly, and a fault also
    // arrives on its own as a machine error.
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  usePendingWsCommandResult(statusRef, {
    onResult: (result) => {
      statusRef.current = null;
      if (result.ok && result.result) setStatus(result.result as PowerMaxStatus);
    },
  });

  usePendingWsCommandResult(enableRef, {
    onResult: (result) => {
      enableRef.current = null;
      // A refused connection is the whole story here: wrong port, no pyserial, bad material.
      setMessage(result.ok ? null : (result.error?.message ?? t('powermax.failed')));
      refresh();
    },
  });

  // No port means no PowerMax on this machine, and nothing worth a panel.
  if (!status?.port) return null;

  const toggle = (enabled: boolean) => {
    setMessage(null);
    const commandId = commands.powermax(enabled);
    if (commandId) enableRef.current = commandId;
  };

  return (
    <div className="flex flex-col gap-2" data-e2e="plasma-powermax">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('powermax.title')}
        </span>
        <span
          className={status.connected ? 'text-xs text-emerald-300' : 'text-xs text-muted-foreground'}
          data-e2e="plasma-powermax-state"
        >
          {status.connected
            ? t('powermax.connected')
            : status.enabled
              ? t('powermax.connecting')
              : t('powermax.offline')}
        </span>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-powermax-toggle"
          data-active={status.enabled}
          onClick={() => toggle(!status.enabled)}
        >
          {status.enabled ? t('powermax.disconnect') : t('powermax.connect')}
        </button>
      </div>

      {status.fault && (
        <div
          className="rounded-md border border-rose-400/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200"
          data-e2e="plasma-powermax-fault"
        >
          <span className="font-semibold">{t('powermax.fault', { code: status.fault.code })}</span>{' '}
          {status.fault.name}
        </div>
      )}

      {status.connected && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <dt>{t('powermax.current')}</dt>
          <dd className="tabular-nums text-foreground" data-e2e="plasma-powermax-current">
            {status.current} A ({status.currentMin}–{status.currentMax})
          </dd>
          <dt>{t('powermax.pressure')}</dt>
          <dd className="tabular-nums text-foreground" data-e2e="plasma-powermax-pressure">
            {status.pressure} {status.pressureUnit} ({status.pressureMin}–{status.pressureMax})
          </dd>
          <dt>{t('powermax.mode')}</dt>
          <dd className="tabular-nums text-foreground" data-e2e="plasma-powermax-mode">
            {status.mode}
          </dd>
          <dt>{t('powermax.arcTime')}</dt>
          <dd className="tabular-nums text-foreground" data-e2e="plasma-powermax-arc-time">
            {hms(status.arcTime)}
          </dd>
        </dl>
      )}

      <span className="text-xs text-muted-foreground" data-e2e="plasma-powermax-port">
        {status.port}
      </span>

      {message && (
        <span className="text-xs text-amber-300" data-e2e="plasma-powermax-error">
          {message}
        </span>
      )}
    </div>
  );
}
