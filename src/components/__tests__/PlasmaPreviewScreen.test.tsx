import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { nearestSegment } from '@/components/plasma/ToolpathCanvas';
import { PlasmaPreviewScreen } from '@/screens/PlasmaPreviewScreen';
import { useAppStore } from '@/store';
import type { PlasmaToolpath, PlasmaToolpathSegment } from '@/store/types';

interface SentCommand {
  category: string;
  action: string;
  params: Record<string, unknown>;
}

function installFakeSocket(): SentCommand[] {
  const sent: SentCommand[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (raw: string) => sent.push(JSON.parse(raw) as SentCommand),
  } as unknown as WebSocket;
  useAppStore.setState({ backendWebSocket: socket });
  return sent;
}

function e2e(name: string): HTMLElement {
  const element = document.querySelector(`[data-e2e="${name}"]`);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element as HTMLElement;
}

function findE2e(name: string): HTMLElement | null {
  return document.querySelector(`[data-e2e="${name}"]`) as HTMLElement | null;
}

const SEGMENTS: PlasmaToolpathSegment[] = [
  { kind: 'rapid', line: 3, pts: [[0, 0, 5], [10, 10, 5]] },
  { kind: 'feed', line: 5, pts: [[10, 10, 1], [50, 10, 1]] },
  { kind: 'feed', line: 9, pts: [[50, 10, 1], [50, 60, 1]] },
];

function toolpath(overrides: Partial<PlasmaToolpath> = {}): PlasmaToolpath {
  return {
    path: '/home/ruben/linuxcnc/nc_files/metric_line.ngc',
    segments: SEGMENTS,
    extents: { min: [0, 0, 1], max: [50, 60, 5] },
    points: 6,
    truncated: false,
    units: 'mm',
    ...overrides,
  };
}

describe('nearestSegment', () => {
  it('finds the cut under a tap and ignores one out of reach', () => {
    const feeds = SEGMENTS.filter((s) => s.kind === 'feed');

    expect(nearestSegment(feeds, 30, 10.5, 2)?.line).toBe(5);
    expect(nearestSegment(feeds, 50.5, 40, 2)?.line).toBe(9);
    expect(nearestSegment(feeds, 200, 200, 2)).toBeNull();
  });
});

describe('PlasmaPreviewScreen', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null });
  });

  it('says there is nothing to show without a program', () => {
    render(<PlasmaPreviewScreen />);

    expect(e2e('plasma-preview-empty').textContent).toContain('No program loaded');
  });

  it('shows the interpreter error rather than an empty canvas', () => {
    useAppStore.getState().setPlasmaToolpathError('cut.ngc:12: Bad character used');

    render(<PlasmaPreviewScreen />);

    expect(e2e('plasma-preview-empty').textContent).toContain('Bad character used');
  });

  it('draws the preview and reports its size', () => {
    useAppStore.getState().setPlasmaToolpath(toolpath());

    render(<PlasmaPreviewScreen />);

    expect(findE2e('toolpath-canvas')).not.toBeNull();
    expect(e2e('plasma-preview-path').textContent).toContain('metric_line.ngc');
    expect(e2e('plasma-preview-points').textContent).toContain('6');
    expect(findE2e('plasma-preview-truncated')).toBeNull();
  });

  it('tells the operator what the program asks for that the drawing cannot show', () => {
    useAppStore.getState().setPlasmaToolpath(
      toolpath({
        notes: {
          directives: { tubeCut: 1 },
          warnings: [
            {
              code: 'feature_unavailable',
              directive: 'tubeCut',
              message: 'this program asks for tube cutting, which this LinuxCNC cannot do',
            },
          ],
        },
      }),
    );

    render(<PlasmaPreviewScreen />);

    expect(e2e('plasma-preview-note-tubeCut').textContent).toContain('tube cutting');
  });

  it('a program with nothing special to say gets no notice', () => {
    useAppStore.getState().setPlasmaToolpath(toolpath());

    render(<PlasmaPreviewScreen />);

    expect(findE2e('plasma-preview-notes')).toBeNull();
  });

  it('warns when the program was too large to preview fully', () => {
    useAppStore.getState().setPlasmaToolpath(toolpath({ truncated: true }));

    render(<PlasmaPreviewScreen />);

    expect(e2e('plasma-preview-truncated').textContent).toContain('truncated');
  });

  it('run from line needs a line picked first', () => {
    useAppStore.getState().setPlasmaToolpath(toolpath());

    render(<PlasmaPreviewScreen />);

    expect((e2e('plasma-preview-run-here') as HTMLButtonElement).disabled).toBe(true);
    expect((e2e('plasma-preview-run-cut') as HTMLButtonElement).disabled).toBe(true);
    expect(e2e('plasma-preview-selected').textContent).toContain('Tap a cut');
  });

  it('asks the backend to refresh the preview', async () => {
    const sent = installFakeSocket();
    useAppStore.getState().setPlasmaToolpath(toolpath());
    render(<PlasmaPreviewScreen />);

    await userEvent.click(e2e('plasma-preview-refresh'));

    expect(sent.map((command) => command.action)).toContain('toolpath');
  });
});
