/**
 * Related G/M-code links (English hints) for linuxCncGcodeMcodeReference.json.
 * Validated when `applyRelatedToReferenceData` runs from augment-code-reference.mjs.
 */

/** @type {Record<string, Array<{ kind: 'g' | 'm'; code: string; hint?: string }>>} */
export const relatedG = {
  G0: [
    { kind: 'g', code: 'G1', hint: 'Feed move instead of rapid' },
    { kind: 'g', code: 'G53', hint: 'Machine coordinates (non-modal, same line as G0/G1)' },
  ],
  G1: [
    { kind: 'g', code: 'G0', hint: 'Rapid / positioning' },
    { kind: 'g', code: 'G94', hint: 'Feed per minute (typical with F)' },
    { kind: 'g', code: 'G95', hint: 'Feed per revolution (not for threading — use G33/G76)' },
  ],
  G2: [
    { kind: 'g', code: 'G3', hint: 'Counterclockwise arc' },
    { kind: 'g', code: 'G17', hint: 'XY plane (default for arcs)' },
    { kind: 'g', code: 'G18', hint: 'ZX plane' },
    { kind: 'g', code: 'G19', hint: 'YZ plane' },
    { kind: 'g', code: 'G91.1', hint: 'I/J/K incremental from arc start (default)' },
    { kind: 'g', code: 'G90.1', hint: 'I/J/K absolute' },
  ],
  G3: [
    { kind: 'g', code: 'G2', hint: 'Clockwise arc' },
    { kind: 'g', code: 'G17', hint: 'XY plane' },
    { kind: 'g', code: 'G18', hint: 'ZX plane' },
    { kind: 'g', code: 'G19', hint: 'YZ plane' },
    { kind: 'g', code: 'G91.1', hint: 'I/J/K incremental' },
    { kind: 'g', code: 'G90.1', hint: 'I/J/K absolute' },
  ],
  G10: [
    { kind: 'g', code: 'G54', hint: 'WCS 1 (G10 L2/L20 sets offsets)' },
    { kind: 'g', code: 'G55', hint: 'Other systems G56–G59.3 similar' },
  ],
  G17: [
    { kind: 'g', code: 'G18', hint: 'Other arc plane' },
    { kind: 'g', code: 'G19', hint: 'Other arc plane' },
    { kind: 'g', code: 'G2', hint: 'Arc in active plane' },
  ],
  G18: [
    { kind: 'g', code: 'G17', hint: 'XY plane' },
    { kind: 'g', code: 'G19', hint: 'YZ plane' },
  ],
  G19: [
    { kind: 'g', code: 'G17', hint: 'XY plane' },
    { kind: 'g', code: 'G18', hint: 'ZX plane' },
  ],
  G20: [{ kind: 'g', code: 'G21', hint: 'Millimeters instead of inches' }],
  G21: [{ kind: 'g', code: 'G20', hint: 'Inches instead of millimeters' }],
  G28: [{ kind: 'g', code: 'G28.1', hint: 'Store reference position for G28' }],
  'G28.1': [{ kind: 'g', code: 'G28', hint: 'Go to stored G28 position' }],
  G30: [{ kind: 'g', code: 'G30.1', hint: 'Store reference position for G30' }],
  'G30.1': [{ kind: 'g', code: 'G30', hint: 'Go to stored G30 position' }],
  G33: [
    { kind: 'g', code: 'G33.1', hint: 'Rigid tapping' },
    { kind: 'm', code: 'M3', hint: 'Spindle must be running' },
    { kind: 'g', code: 'G76', hint: 'Multi-pass threading on lathe' },
  ],
  'G33.1': [
    { kind: 'g', code: 'G33', hint: 'Spindle sync without tap retract cycle' },
    { kind: 'm', code: 'M3', hint: 'Spindle must be running' },
  ],
  'G38.2': [
    { kind: 'g', code: 'G38.3', hint: 'Probe toward part, no error if no trip' },
    { kind: 'g', code: 'G38.4', hint: 'Probe away from part' },
    { kind: 'g', code: 'G38.5', hint: 'Away, no error on failure' },
  ],
  'G38.3': [
    { kind: 'g', code: 'G38.2', hint: 'Probe toward part, error if no trip' },
    { kind: 'g', code: 'G38.4', hint: 'Probe away' },
  ],
  'G38.4': [
    { kind: 'g', code: 'G38.5', hint: 'No error on failure' },
    { kind: 'g', code: 'G38.2', hint: 'Probe toward' },
  ],
  'G38.5': [
    { kind: 'g', code: 'G38.4', hint: 'Error if contact not lost' },
  ],
  G40: [
    { kind: 'g', code: 'G41', hint: 'Cutter radius comp left of path' },
    { kind: 'g', code: 'G42', hint: 'Cutter radius comp right' },
    { kind: 'g', code: 'G41.1', hint: 'Dynamic radius (D = diameter)' },
    { kind: 'g', code: 'G42.1', hint: 'Dynamic radius right' },
    { kind: 'g', code: 'G43', hint: 'Tool length offset from table' },
    { kind: 'g', code: 'G43.1', hint: 'Dynamic length offsets' },
    { kind: 'g', code: 'G43.2', hint: 'Additional length offset' },
    { kind: 'g', code: 'G49', hint: 'Cancel length compensation' },
  ],
  G41: [
    { kind: 'g', code: 'G40', hint: 'Comp off (next move linear, longer than tool dia.)' },
    { kind: 'g', code: 'G42', hint: 'Right instead of left' },
    { kind: 'g', code: 'G41.1', hint: 'Program diameter D' },
    { kind: 'g', code: 'G42.1', hint: 'Dynamic right' },
    { kind: 'g', code: 'G17', hint: 'XY plane typical for milling' },
    { kind: 'g', code: 'G18', hint: 'Comp also in XZ (turn/mill)' },
  ],
  G42: [
    { kind: 'g', code: 'G40', hint: 'Compensation off' },
    { kind: 'g', code: 'G41', hint: 'Left instead of right' },
    { kind: 'g', code: 'G41.1', hint: 'Dynamic left' },
    { kind: 'g', code: 'G42.1', hint: 'Program diameter D' },
    { kind: 'g', code: 'G17', hint: 'Active plane' },
  ],
  'G41.1': [
    { kind: 'g', code: 'G40', hint: 'Compensation off' },
    { kind: 'g', code: 'G41', hint: 'Fixed radius from tool table' },
    { kind: 'g', code: 'G42.1', hint: 'Right with programmed D' },
  ],
  'G42.1': [
    { kind: 'g', code: 'G40', hint: 'Compensation off' },
    { kind: 'g', code: 'G42', hint: 'Fixed radius from table' },
    { kind: 'g', code: 'G41.1', hint: 'Left with programmed D' },
  ],
  G43: [
    { kind: 'g', code: 'G49', hint: 'Cancel length compensation' },
    { kind: 'g', code: 'G43.1', hint: 'Replace offsets with axis words' },
    { kind: 'g', code: 'G43.2', hint: 'Add another offset' },
    { kind: 'm', code: 'M6', hint: 'Tool change; G43 often follows' },
    { kind: 'm', code: 'M61', hint: 'Set tool number only — then G43' },
  ],
  'G43.1': [
    { kind: 'g', code: 'G43', hint: 'Offsets from table' },
    { kind: 'g', code: 'G49', hint: 'Cancel all length comp' },
    { kind: 'g', code: 'G43.2', hint: 'Add on top' },
  ],
  'G43.2': [
    { kind: 'g', code: 'G43', hint: 'Base length offset' },
    { kind: 'g', code: 'G49', hint: 'Cancel length offsets' },
  ],
  G49: [
    { kind: 'g', code: 'G43', hint: 'Enable table offsets' },
    { kind: 'g', code: 'G43.1', hint: 'Dynamic length' },
    { kind: 'g', code: 'G43.2', hint: 'Additional offset' },
  ],
  G52: [
    { kind: 'g', code: 'G54', hint: 'Base WCS (G52 is local shift on top)' },
    { kind: 'g', code: 'G92', hint: 'Global offset — see manual for interaction' },
    { kind: 'g', code: 'G10', hint: 'G10 L2/L20 for G54–G59.3' },
  ],
  G53: [
    { kind: 'g', code: 'G54', hint: 'Back to work coordinates' },
    { kind: 'g', code: 'G0', hint: 'G53 non-modal on same line as G0 or G1' },
  ],
  G54: [
    { kind: 'g', code: 'G55', hint: 'More WCS origins G56–G59.3' },
    { kind: 'g', code: 'G52', hint: 'Local extra offset' },
    { kind: 'g', code: 'G10', hint: 'Set offsets (L2/L20)' },
  ],
  G55: [
    { kind: 'g', code: 'G54', hint: 'Switch WCS' },
    { kind: 'g', code: 'G56', hint: 'G57–G59.3 similar' },
  ],
  G56: [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  G57: [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  G58: [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  G59: [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  'G59.1': [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  'G59.2': [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  'G59.3': [{ kind: 'g', code: 'G54', hint: 'Switch coordinate system' }],
  G61: [
    { kind: 'g', code: 'G61.1', hint: 'Full stop each segment' },
    { kind: 'g', code: 'G64', hint: 'Blend corners / tolerance' },
  ],
  'G61.1': [
    { kind: 'g', code: 'G61', hint: 'Exact path without stop at every corner' },
    { kind: 'g', code: 'G64', hint: 'Tolerance mode' },
  ],
  G64: [
    { kind: 'g', code: 'G61', hint: 'Exact path' },
    { kind: 'g', code: 'G61.1', hint: 'Exact stop' },
  ],
  G70: [
    { kind: 'g', code: 'G71', hint: 'Rough along Z' },
    { kind: 'g', code: 'G72', hint: 'Rough along X (facing)' },
  ],
  G71: [
    { kind: 'g', code: 'G70', hint: 'Finish after roughing' },
    { kind: 'g', code: 'G71.1', hint: 'No pockets' },
    { kind: 'g', code: 'G71.2', hint: 'Continue after G71.1' },
    { kind: 'g', code: 'G72', hint: 'Other roughing pattern' },
  ],
  'G71.1': [
    { kind: 'g', code: 'G71', hint: 'Standard G71' },
    { kind: 'g', code: 'G71.2', hint: 'Second phase' },
  ],
  'G71.2': [
    { kind: 'g', code: 'G71.1', hint: 'First phase' },
    { kind: 'g', code: 'G70', hint: 'Finishing' },
  ],
  G72: [
    { kind: 'g', code: 'G70', hint: 'Finishing' },
    { kind: 'g', code: 'G72.1', hint: 'No pockets' },
    { kind: 'g', code: 'G72.2', hint: 'Continuation' },
    { kind: 'g', code: 'G71', hint: 'Rough along Z' },
  ],
  'G72.1': [
    { kind: 'g', code: 'G72', hint: 'Standard G72' },
    { kind: 'g', code: 'G72.2', hint: 'Continuation' },
  ],
  'G72.2': [
    { kind: 'g', code: 'G72.1', hint: 'First phase' },
    { kind: 'g', code: 'G70', hint: 'Finishing' },
  ],
  G73: [
    { kind: 'g', code: 'G83', hint: 'Peck with full retract to R' },
    { kind: 'g', code: 'G80', hint: 'Cancel canned cycle' },
  ],
  G74: [
    { kind: 'g', code: 'G84', hint: 'Right-hand tapping' },
    { kind: 'g', code: 'G33.1', hint: 'Rigid tap instead of floating' },
  ],
  G76: [
    { kind: 'g', code: 'G33', hint: 'Single-pass spindle sync' },
    { kind: 'm', code: 'M3', hint: 'Spindle for threading' },
  ],
  G80: [
    { kind: 'g', code: 'G81', hint: 'Drilling' },
    { kind: 'g', code: 'G83', hint: 'Peck drilling' },
    { kind: 'g', code: 'G98', hint: 'Retract to initial Z' },
    { kind: 'g', code: 'G99', hint: 'Retract to R' },
  ],
  G81: [
    { kind: 'g', code: 'G80', hint: 'Cancel cycle' },
    { kind: 'g', code: 'G98', hint: 'Retract mode' },
    { kind: 'g', code: 'G99', hint: 'Retract mode' },
    { kind: 'g', code: 'G82', hint: 'With dwell' },
    { kind: 'g', code: 'G83', hint: 'With peck' },
  ],
  G82: [
    { kind: 'g', code: 'G81', hint: 'Without dwell' },
    { kind: 'g', code: 'G80', hint: 'Cancel cycle' },
  ],
  G83: [
    { kind: 'g', code: 'G73', hint: 'Short chip breaks vs full retract' },
    { kind: 'g', code: 'G81', hint: 'Simple drill' },
    { kind: 'g', code: 'G80', hint: 'Cancel cycle' },
  ],
  G84: [
    { kind: 'g', code: 'G74', hint: 'Left-hand tap' },
    { kind: 'g', code: 'G33.1', hint: 'Rigid tapping' },
  ],
  G85: [
    { kind: 'g', code: 'G80', hint: 'Cancel cycle' },
    { kind: 'g', code: 'G86', hint: 'Other bore cycles' },
  ],
  G86: [
    { kind: 'g', code: 'G80', hint: 'Cancel cycle' },
    { kind: 'g', code: 'G89', hint: 'Dwell, feed out' },
  ],
  G89: [{ kind: 'g', code: 'G80', hint: 'Cancel cycle' }],
  G90: [{ kind: 'g', code: 'G91', hint: 'Incremental instead of absolute' }],
  G91: [{ kind: 'g', code: 'G90', hint: 'Absolute instead of incremental' }],
  'G90.1': [
    { kind: 'g', code: 'G91.1', hint: 'Arc center incremental (default)' },
    { kind: 'g', code: 'G2', hint: 'Arc move' },
  ],
  'G91.1': [
    { kind: 'g', code: 'G90.1', hint: 'Arc center absolute' },
    { kind: 'g', code: 'G2', hint: 'Arc move' },
  ],
  G92: [
    { kind: 'g', code: 'G92.1', hint: 'Clear G92 offsets' },
    { kind: 'g', code: 'G92.2', hint: 'Off without clearing parameters' },
    { kind: 'g', code: 'G92.3', hint: 'Restore offsets' },
    { kind: 'g', code: 'G52', hint: 'Local offset in G5x' },
  ],
  'G92.1': [
    { kind: 'g', code: 'G92', hint: 'Set offset' },
    { kind: 'g', code: 'G92.3', hint: 'Re-enable' },
  ],
  'G92.2': [
    { kind: 'g', code: 'G92', hint: 'Set offset' },
    { kind: 'g', code: 'G92.3', hint: 'Restore' },
  ],
  'G92.3': [
    { kind: 'g', code: 'G92.1', hint: 'Full clear' },
    { kind: 'g', code: 'G92.2', hint: 'Disable' },
  ],
  G93: [
    { kind: 'g', code: 'G94', hint: 'Feed per minute' },
    { kind: 'g', code: 'G95', hint: 'Feed per revolution' },
  ],
  G94: [
    { kind: 'g', code: 'G93', hint: 'Inverse time' },
    { kind: 'g', code: 'G95', hint: 'Feed per rev' },
  ],
  G95: [
    { kind: 'g', code: 'G94', hint: 'Feed per minute' },
    { kind: 'g', code: 'G33', hint: 'Threading — not G95' },
    { kind: 'g', code: 'G76', hint: 'Threading cycle (lathe)' },
  ],
  G96: [
    {
      kind: 'g',
      code: 'G97',
      hint: 'Fixed RPM; with G96, S is usually surface speed (see manual)',
    },
  ],
  G97: [
    { kind: 'g', code: 'G96', hint: 'Constant surface speed instead of fixed RPM' },
  ],
  G98: [
    { kind: 'g', code: 'G99', hint: 'Retract to R plane' },
    { kind: 'g', code: 'G81', hint: 'Canned cycles' },
  ],
  G99: [
    { kind: 'g', code: 'G98', hint: 'Retract to initial Z' },
    { kind: 'g', code: 'G81', hint: 'Canned cycles' },
  ],
  G7: [{ kind: 'g', code: 'G8', hint: 'Radius mode on lathe' }],
  G8: [{ kind: 'g', code: 'G7', hint: 'Diameter mode' }],
};

/** @type {Record<string, Array<{ kind: 'g' | 'm'; code: string; hint?: string }>>} */
export const relatedM = {
  M0: [
    { kind: 'm', code: 'M1', hint: 'Optional stop' },
    { kind: 'm', code: 'M2', hint: 'Program end' },
  ],
  M1: [
    { kind: 'm', code: 'M0', hint: 'Program stop' },
    { kind: 'm', code: 'M2', hint: 'Program end' },
  ],
  M2: [
    { kind: 'm', code: 'M30', hint: 'End with rewind/pallet per INI' },
    { kind: 'm', code: 'M5', hint: 'Spindle stop — also applied when M2 ends the program' },
    { kind: 'm', code: 'M9', hint: 'Coolant off' },
  ],
  M30: [{ kind: 'm', code: 'M2', hint: 'Similar program end' }],
  M60: [{ kind: 'm', code: 'M0', hint: 'Pallet change with pause' }],
  M3: [
    { kind: 'm', code: 'M4', hint: 'Spindle CCW' },
    { kind: 'm', code: 'M5', hint: 'Spindle stop' },
    { kind: 'm', code: 'M19', hint: 'Orient — clears M3/M4/M5' },
    { kind: 'g', code: 'G97', hint: 'Typical S in RPM (turning)' },
  ],
  M4: [
    { kind: 'm', code: 'M3', hint: 'Spindle CW' },
    { kind: 'm', code: 'M5', hint: 'Spindle stop' },
    { kind: 'm', code: 'M19', hint: 'Orient' },
  ],
  M5: [
    { kind: 'm', code: 'M3', hint: 'Spindle on CW' },
    { kind: 'm', code: 'M4', hint: 'Spindle on CCW' },
    { kind: 'm', code: 'M19', hint: 'Spindle orient (modal group 7)' },
  ],
  M6: [
    {
      kind: 'g',
      code: 'G43',
      hint: 'Apply length offset after change (select tool with T first)',
    },
    { kind: 'm', code: 'M61', hint: 'Set tool number only, no physical change' },
  ],
  M7: [
    { kind: 'm', code: 'M8', hint: 'Flood coolant' },
    { kind: 'm', code: 'M9', hint: 'All off' },
  ],
  M8: [
    { kind: 'm', code: 'M7', hint: 'Mist' },
    { kind: 'm', code: 'M9', hint: 'All off' },
  ],
  M9: [
    { kind: 'm', code: 'M7', hint: 'Mist on' },
    { kind: 'm', code: 'M8', hint: 'Flood on' },
  ],
  M19: [
    { kind: 'm', code: 'M3', hint: 'Normal spindle on (clears M19)' },
    { kind: 'm', code: 'M4', hint: 'Other direction' },
    { kind: 'm', code: 'M5', hint: 'Stop' },
  ],
  M48: [
    { kind: 'm', code: 'M49', hint: 'Lock overrides' },
    { kind: 'm', code: 'M50', hint: 'Feed override only' },
    { kind: 'm', code: 'M51', hint: 'Spindle override only' },
  ],
  M49: [{ kind: 'm', code: 'M48', hint: 'Allow overrides' }],
  M50: [
    { kind: 'm', code: 'M48', hint: 'Enable both' },
    { kind: 'm', code: 'M49', hint: 'Disable both' },
    { kind: 'm', code: 'M51', hint: 'Spindle separately' },
  ],
  M51: [
    { kind: 'm', code: 'M48', hint: 'Enable both' },
    { kind: 'm', code: 'M49', hint: 'Disable both' },
    { kind: 'm', code: 'M50', hint: 'Feed separately' },
  ],
  M52: [{ kind: 'm', code: 'M53', hint: 'Feed-hold with M53' }],
  M53: [{ kind: 'm', code: 'M52', hint: 'Adaptive feed' }],
  M61: [
    { kind: 'm', code: 'M6', hint: 'Physical tool change' },
    { kind: 'g', code: 'G43', hint: 'Apply length offset' },
  ],
  M62: [
    { kind: 'm', code: 'M63', hint: 'Sync output off' },
    { kind: 'm', code: 'M64', hint: 'Immediate on' },
    { kind: 'm', code: 'M65', hint: 'Immediate off' },
  ],
  M63: [
    { kind: 'm', code: 'M62', hint: 'Sync on' },
    { kind: 'm', code: 'M64', hint: 'Immediate on' },
    { kind: 'm', code: 'M65', hint: 'Immediate off' },
  ],
  M64: [
    { kind: 'm', code: 'M65', hint: 'Immediate off' },
    { kind: 'm', code: 'M62', hint: 'Synced to motion' },
    { kind: 'm', code: 'M63', hint: 'Sync off' },
  ],
  M65: [
    { kind: 'm', code: 'M64', hint: 'Immediate on' },
    { kind: 'm', code: 'M62', hint: 'Sync' },
    { kind: 'm', code: 'M63', hint: 'Sync off' },
  ],
  M66: [
    { kind: 'm', code: 'M62', hint: 'Digital outputs — different use case' },
  ],
  M67: [
    { kind: 'm', code: 'M68', hint: 'Analog immediate' },
    { kind: 'm', code: 'M62', hint: 'Synced like M67' },
  ],
  M68: [{ kind: 'm', code: 'M67', hint: 'Analog with next motion' }],
  M70: [
    { kind: 'm', code: 'M72', hint: 'Restore saved state' },
    { kind: 'm', code: 'M71', hint: 'Invalidate save' },
    { kind: 'm', code: 'M73', hint: 'Auto-restore on sub return' },
  ],
  M71: [
    { kind: 'm', code: 'M70', hint: 'Save' },
    { kind: 'm', code: 'M72', hint: 'Restore' },
  ],
  M72: [
    { kind: 'm', code: 'M70', hint: 'Save first' },
    { kind: 'm', code: 'M73', hint: 'Alternative with auto-restore' },
  ],
  M73: [
    { kind: 'm', code: 'M70', hint: 'Explicit save/restore' },
    { kind: 'm', code: 'M72', hint: 'Restore after M70' },
  ],
  M98: [{ kind: 'm', code: 'M99', hint: 'Return from subprogram' }],
  M99: [{ kind: 'm', code: 'M98', hint: 'Call subprogram' }],
};

/**
 * @param {import('node:fs').PathLike} refPath
 * @param {{ g: Record<string, unknown>; m: Record<string, unknown> }} data
 */
export function validateAndApplyRelated(refPath, data) {
  const errors = [];

  for (const [parentCode, list] of Object.entries(relatedG)) {
    if (!data.g[parentCode]) {
      errors.push(`relatedG: parent G-code "${parentCode}" missing in ${refPath}`);
      continue;
    }
    for (const r of list) {
      const bucket = r.kind === 'g' ? data.g : data.m;
      const k = r.code.trim().toUpperCase();
      if (!bucket[k]) {
        errors.push(
          `relatedG: "${parentCode}" -> ${r.kind}:${r.code} (${k}) not in reference`,
        );
      }
    }
  }

  for (const [parentCode, list] of Object.entries(relatedM)) {
    if (!data.m[parentCode]) {
      errors.push(`relatedM: parent M-code "${parentCode}" missing in ${refPath}`);
      continue;
    }
    for (const r of list) {
      const bucket = r.kind === 'g' ? data.g : data.m;
      const k = r.code.trim().toUpperCase();
      if (!bucket[k]) {
        errors.push(
          `relatedM: "${parentCode}" -> ${r.kind}:${r.code} (${k}) not in reference`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Related-code validation failed:\n${errors.join('\n')}`);
  }

  for (const key of Object.keys(data.g)) {
    if (relatedG[key]) {
      data.g[key].related = relatedG[key];
    } else {
      delete data.g[key].related;
    }
  }
  for (const key of Object.keys(data.m)) {
    if (relatedM[key]) {
      data.m[key].related = relatedM[key];
    } else {
      delete data.m[key].related;
    }
  }
}
