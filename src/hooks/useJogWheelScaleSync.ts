import { useEffect, useRef } from 'react';
import { useSendCommand } from '@/api/backendCommands';
import { useAppStore } from '@/store';

/**
 * Keeps HAL axis.*.jog-scale in sync with IncrementSelector (MPG / jogwheel).
 * Replaces gmoccapy’s jog-increment pin when DISPLAY=plasmaweb.
 * Skips re-sending the same scale (e.g. reconnect with unchanged selection).
 */
export function useJogWheelScaleSync(): void {
  const sendCommand = useSendCommand();
  const selectedJogIncrement = useAppStore((s) => s.selectedJogIncrement);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const lastSentScaleRef = useRef<number | null>(null);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      lastSentScaleRef.current = null;
      return;
    }
    if (!(selectedJogIncrement > 0)) {
      return;
    }
    if (lastSentScaleRef.current === selectedJogIncrement) {
      return;
    }
    lastSentScaleRef.current = selectedJogIncrement;
    sendCommand('hal', 'set_jog_wheel_scale', { scale: selectedJogIncrement });
  }, [selectedJogIncrement, connectionStatus, sendCommand]);
}
