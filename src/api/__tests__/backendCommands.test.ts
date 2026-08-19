import { describe, expect, it } from 'vitest';
import { type CommandCategory, createCommandEnvelope } from '../backendCommands';

describe('createCommandEnvelope', () => {
  const category: CommandCategory = 'machine';

  it('creates a minimal envelope with defaults for params and commandId', () => {
    const envelope = createCommandEnvelope(category, 'set_machine');

    expect(envelope.type).toBe('command');
    expect(envelope.protocolVersion).toBe(1);
    expect(envelope.category).toBe(category);
    expect(envelope.action).toBe('set_machine');
    expect(envelope.params).toEqual({});
    expect(typeof envelope.commandId).toBe('string');
    expect(envelope.commandId.length).toBeGreaterThan(0);
  });

  it('includes params when provided', () => {
    const envelope = createCommandEnvelope(category, 'set_machine', {
      mode: 'AUTO',
      speed: 1000,
    });

    expect(envelope).toEqual({
      type: 'command',
      protocolVersion: 1,
      category,
      action: 'set_machine',
      params: {
        mode: 'AUTO',
        speed: 1000,
      },
      commandId: envelope.commandId,
    });
    expect(typeof envelope.commandId).toBe('string');
  });

  it('includes commandId when provided', () => {
    const envelope = createCommandEnvelope(category, 'set_task_state', undefined, 'cmd-1');

    expect(envelope).toEqual({
      type: 'command',
      protocolVersion: 1,
      category,
      action: 'set_task_state',
      commandId: 'cmd-1',
      params: {},
    });
  });

  it('includes both params and commandId when provided', () => {
    const envelope = createCommandEnvelope(
      'motion',
      'move',
      { x: 1, y: 2, z: 3 },
      'move-123',
    );

    expect(envelope).toEqual({
      type: 'command',
      protocolVersion: 1,
      category: 'motion',
      action: 'move',
      params: { x: 1, y: 2, z: 3 },
      commandId: 'move-123',
    });
  });

  it('allows app category', () => {
    const envelope = createCommandEnvelope('app', 'exit', {}, 'exit-1');
    expect(envelope.category).toBe('app');
    expect(envelope.action).toBe('exit');
  });
});

