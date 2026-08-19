import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/store';
import { applyLcncguiConfigToStore, parseLcncguiConfigJson } from '../loadLcncguiConfig';

describe('applyLcncguiConfigToStore kioskMode', () => {
  beforeEach(() => {
    useAppStore.setState({ kioskMode: true });
  });

  it('uses config kioskMode when user preference is null', () => {
    const parsed = parseLcncguiConfigJson({
      websocketUrl: 'ws://127.0.0.1:8765/ws',
      ui: { kioskMode: false },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    applyLcncguiConfigToStore(parsed.config, null);
    expect(useAppStore.getState().kioskMode).toBe(false);
  });

  it('prefers user preference over config kioskMode', () => {
    const parsed = parseLcncguiConfigJson({
      websocketUrl: 'ws://127.0.0.1:8765/ws',
      ui: { kioskMode: true },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    applyLcncguiConfigToStore(parsed.config, false);
    expect(useAppStore.getState().kioskMode).toBe(false);
  });
});
