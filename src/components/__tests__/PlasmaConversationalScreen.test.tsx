import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlasmaConversationalScreen } from '@/screens/PlasmaConversationalScreen';
import { useAppStore } from '@/store';
import type { LastWsCommandResult } from '@/store/types';

interface SentCommand {
  commandId: string;
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
  useAppStore.setState({ backendWebSocket: socket, plasmaAvailable: true });
  return sent;
}

/** Deliver a `command_result` the way the WebSocket hook does. */
function answer(result: LastWsCommandResult) {
  act(() => {
    useAppStore.setState((prev) => ({
      commandResultHistory: [...prev.commandResultHistory, result],
      lastWsCommandResult: result,
    }));
  });
}

function e2e(name: string): HTMLElement {
  const element = document.querySelector(`[data-e2e="${name}"]`);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element as HTMLElement;
}

function findE2e(name: string): HTMLElement | null {
  return document.querySelector(`[data-e2e="${name}"]`) as HTMLElement | null;
}

const SHAPES = {
  circle: [
    { name: 'matNumber', required: true, default: null },
    { name: 'matName', required: true, default: null },
    { name: 'preAmble', required: true, default: null },
    { name: 'postAmble', required: true, default: null },
    { name: 'leadinLength', required: true, default: null },
    { name: 'leadoutLength', required: true, default: null },
    { name: 'isCenter', required: true, default: null },
    { name: 'xOffset', required: true, default: null },
    { name: 'yOffset', required: true, default: null },
    { name: 'kerfWidth', required: true, default: null },
    { name: 'isExternal', required: true, default: null },
    { name: 'isOvercut', required: true, default: null },
    { name: 'overCut', required: true, default: null },
    { name: 'smallHoleDia', required: true, default: null },
    { name: 'smallHoleSpeed', required: true, default: null },
    { name: 'diameter', required: true, default: null },
    { name: 'invalidLeads', required: true, default: null },
  ],
  slot: [
    { name: 'matNumber', required: true, default: null },
    { name: 'length', required: true, default: null },
    { name: 'width', required: true, default: null },
    { name: 'angle', required: true, default: null },
  ],
};

function deliverShapes(sent: SentCommand[]) {
  const request = sent.find((command) => command.action === 'conversational_shapes');
  expect(request).toBeDefined();
  answer({ commandId: request!.commandId, ok: true, result: { shapes: SHAPES } });
}

describe('PlasmaConversationalScreen', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({
      backendWebSocket: null,
      commandResultHistory: [],
      lastWsCommandResult: null,
    });
  });

  it('asks the machine which shapes it can generate', () => {
    const sent = installFakeSocket();

    render(<PlasmaConversationalScreen />);

    expect(sent.map((command) => command.action)).toEqual(['conversational_shapes']);
    expect(findE2e('plasma-conversational-loading')).not.toBeNull();
  });

  it('builds the form from the schema, without the machine-supplied parameters', () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);

    deliverShapes(sent);

    // Geometry the operator sets…
    expect(findE2e('plasma-conversational-diameter')).not.toBeNull();
    expect(findE2e('plasma-conversational-isExternal')).not.toBeNull();
    // …but not what comes from the material and the prefs.
    expect(findE2e('plasma-conversational-kerfWidth')).toBeNull();
    expect(findE2e('plasma-conversational-leadinLength')).toBeNull();
    expect(findE2e('plasma-conversational-matNumber')).toBeNull();
  });

  it('switching shape rebuilds the form', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-shape-slot'));

    expect(findE2e('plasma-conversational-length')).not.toBeNull();
    expect(findE2e('plasma-conversational-diameter')).toBeNull();
  });

  it('preview sends the geometry and then previews what came back', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-preview'));

    const generate = sent.find((command) => command.action === 'conversational');
    expect(generate).toBeDefined();
    expect(generate!.params.shape).toBe('circle');
    expect(generate!.params.save).toBe(false);
    expect((generate!.params.params as Record<string, unknown>).diameter).toBe(0);
    expect((generate!.params.params as Record<string, unknown>).kerfWidth).toBeUndefined();

    answer({
      commandId: generate!.commandId,
      ok: true,
      result: { gcode: '(conversational circle)\nM2\n', error: null },
    });

    const preview = sent.find((command) => command.action === 'toolpath');
    expect(preview?.params.gcode).toContain('conversational circle');
  });

  it("shows the shape's own complaint instead of a canvas", async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);
    await userEvent.click(e2e('plasma-conversational-preview'));
    const generate = sent.find((command) => command.action === 'conversational');

    answer({
      commandId: generate!.commandId,
      ok: true,
      result: { gcode: null, error: 'DIAMETER cannot be zero' },
    });

    expect(e2e('plasma-conversational-message').textContent).toContain('DIAMETER cannot be zero');
    expect(findE2e('toolpath-canvas')).toBeNull();
  });

  it('adding a shape carries the job into the next generate', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);
    await userEvent.click(e2e('plasma-conversational-preview'));
    const first = sent.find((command) => command.action === 'conversational');
    answer({
      commandId: first!.commandId,
      ok: true,
      result: { gcode: '(conversational circle)\nM2\n', error: null },
    });

    await userEvent.click(e2e('plasma-conversational-add'));
    await userEvent.click(e2e('plasma-conversational-preview'));

    const second = sent.filter((command) => command.action === 'conversational')[1];
    expect(second.params.job).toContain('conversational circle');
    expect(e2e('plasma-conversational-job').textContent).toContain('Job:');
  });

  it('save asks for the job to be written and loaded', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-save'));

    const generate = sent.find((command) => command.action === 'conversational');
    expect(generate!.params.save).toBe(true);
  });
});

describe('PlasmaConversationalScreen — lines and arrays', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({
      backendWebSocket: null,
      commandResultHistory: [],
      lastWsCommandResult: null,
    });
  });

  it('offers the line builder and the array alongside the shapes', () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);

    deliverShapes(sent);

    expect(findE2e('plasma-conversational-shape-line')).not.toBeNull();
    expect(findE2e('plasma-conversational-shape-block')).not.toBeNull();
  });

  it('builds a cut from segments, each starting where the last ended', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-shape-line'));
    await userEvent.click(e2e('plasma-line-kind-point'));
    await userEvent.click(e2e('plasma-line-add'));
    await userEvent.click(e2e('plasma-line-kind-arcRadius'));
    await userEvent.click(e2e('plasma-line-add'));
    await userEvent.click(e2e('plasma-conversational-preview'));

    const request = sent.find((command) => command.action === 'conversational_line');
    expect(request).toBeDefined();
    const segments = request!.params.segments as Array<Record<string, unknown>>;
    expect(segments.map((segment) => segment.kind)).toEqual(['point', 'arcRadius']);
    // The arc direction is the G-code word, kept as a string.
    expect(segments[1].arcType).toBe('02');
    expect(segments[0].xEnd).toBe(0);
  });

  it('removing the last segment takes it off the list', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);
    await userEvent.click(e2e('plasma-conversational-shape-line'));
    await userEvent.click(e2e('plasma-line-add'));
    await userEvent.click(e2e('plasma-line-add'));

    await userEvent.click(e2e('plasma-line-remove'));

    expect(findE2e('plasma-line-segment-0')).not.toBeNull();
    expect(findE2e('plasma-line-segment-1')).toBeNull();
  });

  it('the array sends the block parameters and its toggles', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-shape-block'));
    await userEvent.click(e2e('plasma-block-doMirror'));
    await userEvent.click(e2e('plasma-conversational-preview'));

    const request = sent.find((command) => command.action === 'conversational_block');
    expect(request).toBeDefined();
    const params = request!.params.params as Record<string, unknown>;
    expect(params.columns).toBe(2);
    expect(params.rows).toBe(2);
    expect(params.scale).toBe(1);
    expect(params.doMirror).toBe(true);
    expect(params.doFlip).toBe(false);
  });
});

describe('PlasmaConversationalScreen — settings', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({
      backendWebSocket: null,
      commandResultHistory: [],
      lastWsCommandResult: null,
    });
  });

  it('reads the conversational settings when the tab is opened, then saves them', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-shape-settings'));

    const request = sent.find((command) => command.action === 'get_conversational_settings');
    expect(request).toBeDefined();
    answer({
      commandId: request!.commandId,
      ok: true,
      result: { settings: { Leadin: 5, Leadout: 5, 'Hole speed': 60, Origin: 1 } },
    });

    expect(e2e('plasma-setting-leadin').textContent).toContain('5');

    await userEvent.click(e2e('plasma-conversational-settings-save'));

    const save = sent.find((command) => command.action === 'save_conversational_settings');
    const values = save!.params.values as Record<string, unknown>;
    expect(values.Leadin).toBe(5);
    // Integers stay integers, so QtPlasmaC's getint still reads them.
    expect(values['Hole speed']).toBe(60);
    expect(values.Origin).toBe(1);
  });

  it('the shape buttons are hidden behind nothing: settings has no preview row', async () => {
    const sent = installFakeSocket();
    render(<PlasmaConversationalScreen />);
    deliverShapes(sent);

    await userEvent.click(e2e('plasma-conversational-shape-settings'));

    expect(findE2e('plasma-conversational-settings')).not.toBeNull();
    expect(e2e('plasma-conversational-preview').closest('div')?.className).toContain('hidden');
  });
});
