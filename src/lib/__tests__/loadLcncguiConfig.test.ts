import { describe, expect, it } from 'vitest';
import { parseLcncguiConfigJson } from '../loadLcncguiConfig';

describe('parseLcncguiConfigJson', () => {
  it('accepts minimal valid config with defaults for ui', () => {
    const r = parseLcncguiConfigJson({ websocketUrl: 'ws://127.0.0.1:8765/ws' });
    expect(r).toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        websocketUrl: 'ws://127.0.0.1:8765/ws',
        ui: {
          showVirtualSidebar: true,
          kioskMode: true,
          debugLoggingEnabled: false,
          debugLogEventBus: true,
          debugLogWsOutgoing: true,
          debugLogWsIncoming: false,
          coordinateUiFlushMs: 66,
        },
      },
    });
  });

  it('trims websocketUrl and accepts wss', () => {
    const r = parseLcncguiConfigJson({ websocketUrl: '  wss://example.com/ws  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.websocketUrl).toBe('wss://example.com/ws');
  });

  it('merges partial ui booleans with defaults', () => {
    const r = parseLcncguiConfigJson({
      websocketUrl: 'ws://h/ws',
      ui: { showVirtualSidebar: false, debugLoggingEnabled: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.ui.showVirtualSidebar).toBe(false);
      expect(r.config.ui.debugLoggingEnabled).toBe(true);
      expect(r.config.ui.debugLogEventBus).toBe(true);
      expect(r.config.ui.debugLogWsIncoming).toBe(false);
    }
  });

  it('rejects non-object root', () => {
    expect(parseLcncguiConfigJson(null).ok).toBe(false);
    expect(parseLcncguiConfigJson([]).ok).toBe(false);
    expect(parseLcncguiConfigJson('x').ok).toBe(false);
  });

  it('rejects missing or empty websocketUrl', () => {
    expect(parseLcncguiConfigJson({}).ok).toBe(false);
    expect(parseLcncguiConfigJson({ websocketUrl: '' }).ok).toBe(false);
    expect(parseLcncguiConfigJson({ websocketUrl: '   ' }).ok).toBe(false);
  });

  it('resolves websocketUrl auto from window.location', () => {
    const r = parseLcncguiConfigJson({ websocketUrl: 'auto' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.websocketUrl).toMatch(/^wss?:\/\/.+\/ws$/);
    }
  });

  it('rejects websocketUrl without ws scheme', () => {
    expect(parseLcncguiConfigJson({ websocketUrl: 'http://x/ws' }).ok).toBe(false);
    expect(parseLcncguiConfigJson({ websocketUrl: 'ftp://x/ws' }).ok).toBe(false);
  });

  it('clamps coordinateUiFlushMs to allowed range', () => {
    const low = parseLcncguiConfigJson({
      websocketUrl: 'ws://x/ws',
      ui: { coordinateUiFlushMs: 1 },
    });
    expect(low.ok).toBe(true);
    if (low.ok) expect(low.config.ui.coordinateUiFlushMs).toBe(16);

    const high = parseLcncguiConfigJson({
      websocketUrl: 'ws://x/ws',
      ui: { coordinateUiFlushMs: 9999 },
    });
    expect(high.ok).toBe(true);
    if (high.ok) expect(high.config.ui.coordinateUiFlushMs).toBe(500);
  });

  it('ignores non-boolean ui fields and uses defaults', () => {
    const r = parseLcncguiConfigJson({
      websocketUrl: 'ws://x/ws',
      ui: { showVirtualSidebar: 'yes' as unknown as boolean },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.ui.showVirtualSidebar).toBe(true);
  });

  it('accepts explicit kioskMode false', () => {
    const r = parseLcncguiConfigJson({
      websocketUrl: 'ws://x/ws',
      ui: { kioskMode: false },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.ui.kioskMode).toBe(false);
  });
});
