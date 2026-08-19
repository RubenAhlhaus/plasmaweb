import { describe, expect, it } from 'vitest';
import {
  LCNC_GUI_COMMENT_DELIM,
  buildToolTableCommentSuffix,
  parseLcncGuiMeta,
  splitLcncGuiComment,
} from '@/lib/lcncGuiToolComment';
import { mapLinuxCncToolRowToTool } from '@/lib/linuxCncToolTable';

describe('splitLcncGuiComment', () => {
  it('returns full string as human when no delimiter', () => {
    expect(splitLcncGuiComment('hello')).toEqual({ humanPrefix: 'hello', metaJson: null });
  });

  it('splits human and json after delimiter', () => {
    const json = '{"name":"x","type":"Drill"}';
    const raw = `note ${LCNC_GUI_COMMENT_DELIM}${json}`;
    expect(splitLcncGuiComment(raw)).toEqual({
      humanPrefix: 'note',
      metaJson: json,
    });
  });
});

describe('parseLcncGuiMeta', () => {
  it('parses valid json', () => {
    const s = `prefix ${LCNC_GUI_COMMENT_DELIM}{"name":"A","type":"Drill","material":"HSS"}`;
    expect(parseLcncGuiMeta(s)).toEqual({
      name: 'A',
      type: 'Drill',
      material: 'HSS',
    });
  });

  it('returns null for invalid json', () => {
    expect(parseLcncGuiMeta(`x ${LCNC_GUI_COMMENT_DELIM}{`)).toBeNull();
  });
});

describe('buildToolTableCommentSuffix', () => {
  it('returns empty string when meta is empty', () => {
    expect(buildToolTableCommentSuffix({})).toBe('');
  });

  it('builds delimiter and json when meta has fields', () => {
    const s = buildToolTableCommentSuffix({
      name: 'VHM 6mm',
      type: 'Flat End Mill',
      material: 'VHM',
      comment: 'Stahl',
    });
    expect(s).toContain(LCNC_GUI_COMMENT_DELIM);
    expect(parseLcncGuiMeta(s)).toEqual({
      name: 'VHM 6mm',
      type: 'Flat End Mill',
      material: 'VHM',
      comment: 'Stahl',
    });
    expect(splitLcncGuiComment(s).humanPrefix).toBe('');
  });

  it('roundtrips with splitLcncGuiComment and parseLcncGuiMeta', () => {
    const built = buildToolTableCommentSuffix({ name: 'A', type: 'Drill' });
    expect(splitLcncGuiComment(built)).toEqual({
      humanPrefix: '',
      metaJson: '{"name":"A","type":"Drill"}',
    });
    expect(parseLcncGuiMeta(built)).toEqual({ name: 'A', type: 'Drill' });
  });

  it('includes Schneiden meta and roundtrips', () => {
    const s = buildToolTableCommentSuffix({
      name: 'Fräser',
      type: 'Flat End Mill',
      numberOfFlutes: 4,
      flutesLength: 18.5,
    });
    expect(parseLcncGuiMeta(s)).toEqual({
      name: 'Fräser',
      type: 'Flat End Mill',
      numberOfFlutes: 4,
      flutesLength: 18.5,
    });
  });
});

describe('mapLinuxCncToolRowToTool', () => {
  it('maps offsets and meta', () => {
    const row = {
      toolno: 3,
      pocket: 3,
      diameter: 5,
      zoffset: 1.5,
      comment: `bohren ${LCNC_GUI_COMMENT_DELIM}{"name":"Bohrer","type":"Drill","material":"HSS"}`,
    };
    const t = mapLinuxCncToolRowToTool(row);
    expect(t).not.toBeNull();
    if (!t) throw new Error('expected tool');
    expect(t.id).toBe('T3');
    expect(t.name).toBe('Bohrer');
    expect(t.type).toBe('Drill');
    expect(t.material).toBe('HSS');
    expect(t.offsetZ).toBe(1.5);
    expect(t.rawTableComment).toBe(
      `bohren ${LCNC_GUI_COMMENT_DELIM}{"name":"Bohrer","type":"Drill","material":"HSS"}`,
    );
  });

  it('maps numberOfFlutes and flutesLength from lcncgui meta', () => {
    const json = '{"name":"F","type":"Flat End Mill","numberOfFlutes":3,"flutesLength":12}';
    const t = mapLinuxCncToolRowToTool({
      toolno: 5,
      comment: `${LCNC_GUI_COMMENT_DELIM}${json}`,
    });
    expect(t).not.toBeNull();
    if (!t) throw new Error('expected tool');
    expect(t.numberOfFlutes).toBe(3);
    expect(t.flutesLength).toBe(12);
  });

  it('returns null for toolno 0', () => {
    expect(mapLinuxCncToolRowToTool({ toolno: 0 })).toBeNull();
  });

  it('uses pocketno when pocket is absent (LinuxCNC naming)', () => {
    const t = mapLinuxCncToolRowToTool({
      toolno: 2,
      pocketno: 11,
      diameter: 6,
      comment: '',
    });
    expect(t).not.toBeNull();
    if (!t) throw new Error('expected tool');
    expect(t.pocketNumber).toBe(11);
  });
});
