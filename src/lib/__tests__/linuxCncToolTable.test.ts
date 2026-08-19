import { describe, expect, it } from 'vitest';
import { mapLinuxCncToolRowToTool, mapToolTableToTools } from '@/lib/linuxCncToolTable';
import type { LinuxCncToolTableRow } from '@/store/types';

describe('mapToolTableToTools', () => {
  it('deduplicates rows with the same tool number (last row wins)', () => {
    const rows: LinuxCncToolTableRow[] = [
      { toolno: 1, zoffset: 0 },
      { toolno: 2, zoffset: 0 },
      { toolno: 1, zoffset: 1.5 },
    ];
    const tools = mapToolTableToTools(rows);
    expect(tools.map((t) => t.id)).toEqual(['T1', 'T2']);
    expect(tools.find((t) => t.id === 'T1')?.offsetZ).toBe(1.5);
  });

  it('sorts by tool number after deduplication', () => {
    const rows: LinuxCncToolTableRow[] = [
      { toolno: 3 },
      { toolno: 1 },
      { toolno: 2 },
    ];
    const tools = mapToolTableToTools(rows);
    expect(tools.map((t) => t.toolNumber)).toEqual([1, 2, 3]);
  });

  it('prefers lcncgui_meta from sidecar over comment', () => {
    const rows: LinuxCncToolTableRow[] = [
      {
        toolno: 4,
        comment: 'disk',
        lcncgui_meta: { name: 'Sidecar', type: 'Drill', material: 'HSS' },
        lcncgui_presets: [{ id: 'a1', name: 'Rough', spindle_rpm: 1000 }],
      },
    ];
    const tools = mapToolTableToTools(rows);
    expect(tools[0]?.name).toBe('Sidecar');
    expect(tools[0]?.type).toBe('Drill');
    expect(tools[0]?.lcncguiPresets?.[0]?.name).toBe('Rough');
    expect(tools[0]?.lcncguiPresets?.[0]?.spindle_rpm).toBe(1000);
  });

  it('maps extended preset fields from lcncgui_presets', () => {
    const rows: LinuxCncToolTableRow[] = [
      {
        toolno: 5,
        lcncgui_presets: [
          {
            id: 'p2',
            name: 'Finish',
            feed_per_tooth_mm: 0.08,
            use_stepover: true,
            max_stepover_mm: 3,
            coolant: 'mist',
          },
        ],
      },
    ];
    const tools = mapToolTableToTools(rows);
    const preset = tools[0]?.lcncguiPresets?.[0];
    expect(preset?.feed_per_tooth_mm).toBe(0.08);
    expect(preset?.use_stepover).toBe(true);
    expect(preset?.max_stepover_mm).toBe(3);
    expect(preset?.coolant).toBe('mist');
  });
});

describe('mapLinuxCncToolRowToTool', () => {
  it('drops non-canonical material from meta', () => {
    const t = mapLinuxCncToolRowToTool({
      toolno: 9,
      lcncgui_meta: { name: 'F', material: 'VHM' },
    });
    expect(t).not.toBeNull();
    expect(t?.material).toBeUndefined();
  });
});
