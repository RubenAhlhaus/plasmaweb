/**
 * Merges summary, syntax, and related-code links into linuxCncGcodeMcodeReference.json.
 * Related entries live in `code-reference-related.mjs` and are validated against the JSON keys.
 * Run: node scripts/augment-code-reference.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndApplyRelated } from './code-reference-related.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const refPath = path.join(root, 'src/data/linuxCncGcodeMcodeReference.json');

/** @type {Record<string, { summary: string; syntax: string }>} */
const g = {
  G0: {
    summary: 'Positions all programmed axes in one rapid move at traverse speed.',
    syntax: 'G0 (X, Y, Z, A, B, C, U, V, W — optional)',
  },
  G1: {
    summary: 'Moves in a straight line at the current feed rate.',
    syntax: 'G1 (X, Y, Z, …) F',
  },
  G2: {
    summary: 'Helical or circular arc clockwise in the active plane at feed rate.',
    syntax: 'G2 (X, Y, Z, I, J, P, F) or G2 (X, Y, Z, R, P, F)',
  },
  G3: {
    summary: 'Helical or circular arc counterclockwise in the active plane at feed rate.',
    syntax: 'G3 (X, Y, Z, I, J, P, F) or G3 (X, Y, Z, R, P, F)',
  },
  G4: {
    summary: 'Dwells with all axes stopped for the given time.',
    syntax: 'G4 P',
  },
  G5: {
    summary: 'Cuts a cubic B-spline segment in the XY plane.',
    syntax: 'G5 X Y I J P Q',
  },
  'G5.1': {
    summary: 'Cuts a quadratic B-spline in the XY plane.',
    syntax: 'G5.1 X Y I J',
  },
  'G5.2': {
    summary: 'Opens a NURBS block (experimental).',
    syntax: 'G5.2 (P, X, Y, L, …) … G5.3',
  },
  'G5.3': {
    summary: 'Closes the NURBS block opened with G5.2.',
    syntax: 'G5.3',
  },
  G7: {
    summary: 'Interprets lathe X moves as diameter.',
    syntax: 'G7',
  },
  G8: {
    summary: 'Interprets lathe X moves as radius from center.',
    syntax: 'G8',
  },
  G10: {
    summary: 'Writes tool table or coordinate system data; L selects the operation.',
    syntax: 'G10 L0 | G10 L1 P … | G10 L2 P … | G10 L10/L11 P … | G10 L20 P …',
  },
  G17: {
    summary: 'Selects the XY plane for arcs and canned cycles.',
    syntax: 'G17',
  },
  G18: {
    summary: 'Selects the ZX plane for arcs and canned cycles.',
    syntax: 'G18',
  },
  G19: {
    summary: 'Selects the YZ plane for arcs and canned cycles.',
    syntax: 'G19',
  },
  'G17.1': {
    summary: 'Selects the UV plane (no arcs).',
    syntax: 'G17.1',
  },
  'G18.1': {
    summary: 'Selects the WU plane (no arcs).',
    syntax: 'G18.1',
  },
  'G19.1': {
    summary: 'Selects the VW plane (no arcs).',
    syntax: 'G19.1',
  },
  G20: {
    summary: 'Uses inches for length units.',
    syntax: 'G20',
  },
  G21: {
    summary: 'Uses millimeters for length units.',
    syntax: 'G21',
  },
  G28: {
    summary: 'Rapids via optional axes to the stored machine G28 position.',
    syntax: 'G28 (X, Y, Z, … optional intermediate) or G28',
  },
  'G28.1': {
    summary: 'Stores the current absolute position as the G28 reference.',
    syntax: 'G28.1',
  },
  G30: {
    summary: 'Rapids via optional axes to the stored machine G30 position.',
    syntax: 'G30 (X, Y, Z, … optional intermediate) or G30',
  },
  'G30.1': {
    summary: 'Stores the current absolute position as the G30 reference.',
    syntax: 'G30.1',
  },
  G33: {
    summary: 'Moves linearly in sync with spindle rotation; K is distance per revolution.',
    syntax: 'G33 (X, Y, Z, K, $)',
  },
  'G33.1': {
    summary: 'Rigid tapping: synchronized in-feed, spindle reverse, and return.',
    syntax: 'G33.1 (X, Y, Z, K, I, $)',
  },
  'G38.2': {
    summary: 'Probes in a straight line toward the part and errors if no trip.',
    syntax: 'G38.2 (X, Y, Z, …) F',
  },
  'G38.3': {
    summary: 'Probes toward the part without error if the probe does not trip.',
    syntax: 'G38.3 (X, Y, Z, …) F',
  },
  'G38.4': {
    summary: 'Probes away from the part and errors if contact is not lost.',
    syntax: 'G38.4 (X, Y, Z, …) F',
  },
  'G38.5': {
    summary: 'Probes away from the part without error if contact is not lost.',
    syntax: 'G38.5 (X, Y, Z, …) F',
  },
  G40: {
    summary: 'Turns off cutter radius compensation.',
    syntax: 'G40',
  },
  G41: {
    summary: 'Offsets the path to the left of the programmed line (active plane).',
    syntax: 'G41 (D)',
  },
  G42: {
    summary: 'Offsets the path to the right of the programmed line (active plane).',
    syntax: 'G42 (D)',
  },
  'G41.1': {
    summary: 'Cutter comp left with programmed diameter D (optional L on lathe).',
    syntax: 'G41.1 D (L)',
  },
  'G42.1': {
    summary: 'Cutter comp right with programmed diameter D (optional L on lathe).',
    syntax: 'G42.1 D (L)',
  },
  G43: {
    summary: 'Applies tool length offset from the tool table (no motion).',
    syntax: 'G43 (H)',
  },
  'G43.1': {
    summary: 'Replaces dynamic tool length offsets with axis values (no motion).',
    syntax: 'G43.1 (X, Y, Z, …)',
  },
  'G43.2': {
    summary: 'Adds another tool table offset or extra axis offsets (no motion).',
    syntax: 'G43.2 H  or  G43.2 (X, Y, Z, …)',
  },
  G49: {
    summary: 'Cancels tool length compensation.',
    syntax: 'G49',
  },
  G52: {
    summary: 'Sets a temporary local offset in the current work system.',
    syntax: 'G52 (X, Y, Z, …)',
  },
  G53: {
    summary: 'Moves in machine coordinates on this line (with G0/G1).',
    syntax: 'G53 G0|G1 (X, Y, Z, …)',
  },
  G54: { summary: 'Selects work coordinate system 1.', syntax: 'G54' },
  G55: { summary: 'Selects work coordinate system 2.', syntax: 'G55' },
  G56: { summary: 'Selects work coordinate system 3.', syntax: 'G56' },
  G57: { summary: 'Selects work coordinate system 4.', syntax: 'G57' },
  G58: { summary: 'Selects work coordinate system 5.', syntax: 'G58' },
  G59: { summary: 'Selects work coordinate system 6.', syntax: 'G59' },
  'G59.1': { summary: 'Selects work coordinate system 7.', syntax: 'G59.1' },
  'G59.2': { summary: 'Selects work coordinate system 8.', syntax: 'G59.2' },
  'G59.3': { summary: 'Selects work coordinate system 9.', syntax: 'G59.3' },
  G61: {
    summary: 'Exact path mode: follows programmed points (may slow at corners).',
    syntax: 'G61',
  },
  'G61.1': {
    summary: 'Exact stop mode: full stop at each segment end.',
    syntax: 'G61.1',
  },
  G64: {
    summary: 'Path blending; optional P and Q control tolerance and naive-CAM merge.',
    syntax: 'G64 (P, Q)',
  },
  G70: {
    summary: 'Finishing pass along subroutine Q after G71/G72 roughing (lathe).',
    syntax: 'G70 Q (X, Z, D, E, P)',
  },
  G71: {
    summary: 'Z-direction roughing cycle using profile subroutine Q (lathe).',
    syntax: 'G71 Q (X, Z, D, I, R)',
  },
  'G71.1': {
    summary: 'G71 variant that does not cut pockets.',
    syntax: 'G71.1 Q (X, Z, D, I, R)',
  },
  'G71.2': {
    summary: 'Continues G71 roughing after G71.1 stopped.',
    syntax: 'G71.2 Q (X, Z, D, I, R)',
  },
  G72: {
    summary: 'X-direction (facing) roughing cycle using profile subroutine Q (lathe).',
    syntax: 'G72 Q (X, Z, D, I, R)',
  },
  'G72.1': {
    summary: 'G72 variant that does not cut pockets.',
    syntax: 'G72.1 Q (X, Z, D, I, R)',
  },
  'G72.2': {
    summary: 'Continues G72 roughing after G72.1 stopped.',
    syntax: 'G72.2 Q (X, Z, D, I, R)',
  },
  G73: {
    summary: 'Drilling with chip-breaking pecks along the cycle axis.',
    syntax: 'G73 (X, Y, Z, R, Q, L)',
  },
  G74: {
    summary: 'Left-hand floating tap cycle with dwell (not rigid/sync).',
    syntax: 'G74 (X, Y, Z, U, V, W, R, L, P, $, F)',
  },
  G76: {
    summary: 'Multi-pass lathe threading synchronized to the spindle.',
    syntax: 'G76 P Z I J K (R, Q, H, E, L, $)',
  },
  G80: {
    summary: 'Cancels canned-cycle modal motion (G81–G89).',
    syntax: 'G80',
  },
  G81: {
    summary: 'Drill cycle: feed to Z, then retract per G98/G99.',
    syntax: 'G81 (X, Y, Z, U, V, W, R, L)',
  },
  G82: {
    summary: 'Drill cycle with dwell at bottom.',
    syntax: 'G82 (X, Y, Z, U, V, W, R, L, P)',
  },
  G83: {
    summary: 'Peck drill with retract to R for chip clearing.',
    syntax: 'G83 (X, Y, Z, U, V, W, R, L, Q)',
  },
  G84: {
    summary: 'Right-hand floating tap cycle with dwell (not rigid/sync).',
    syntax: 'G84 (X, Y, Z, U, V, W, R, L, P, $, F)',
  },
  G85: {
    summary: 'Bore in at feed, feed retract, then rapid clear.',
    syntax: 'G85 (X, Y, Z, U, V, W, R, L)',
  },
  G86: {
    summary: 'Bore, dwell, stop spindle, rapid out, restart spindle.',
    syntax: 'G86 (X, Y, Z, U, V, W, R, L, P, $)',
  },
  G87: {
    summary: 'Back-boring cycle (accepted; behavior undefined / not implemented).',
    syntax: 'G87 (see manual)',
  },
  G88: {
    summary: 'Boring cycle with manual retract (accepted; not fully implemented).',
    syntax: 'G88 (see manual)',
  },
  G89: {
    summary: 'Bore with dwell at bottom, then feed out.',
    syntax: 'G89 (X, Y, Z, U, V, W, R, L, P)',
  },
  G90: {
    summary: 'Axis words are absolute positions in the active coordinate system.',
    syntax: 'G90',
  },
  G91: {
    summary: 'Axis words are increments from the current position.',
    syntax: 'G91',
  },
  'G90.1': {
    summary: 'Arc center offsets I J K are absolute.',
    syntax: 'G90.1',
  },
  'G91.1': {
    summary: 'Arc center offsets I J K are incremental from arc start (default).',
    syntax: 'G91.1',
  },
  G92: {
    summary: 'Shifts all coordinate origins so the current point matches the given values.',
    syntax: 'G92 (X, Y, Z, … — at least one axis)',
  },
  'G92.1': {
    summary: 'Clears G92 offsets and zeros the stored parameters.',
    syntax: 'G92.1',
  },
  'G92.2': {
    summary: 'Disables G92 offsets but keeps parameter values for G92.3.',
    syntax: 'G92.2',
  },
  'G92.3': {
    summary: 'Restores G92 offsets from saved parameters.',
    syntax: 'G92.3',
  },
  G93: {
    summary: 'Inverse time: F is minutes⁻¹ for each feed move.',
    syntax: 'G93',
  },
  G94: {
    summary: 'Feed rate is length units per minute (or deg/min on rotary axes).',
    syntax: 'G94',
  },
  G95: {
    summary: 'Feed rate is units per spindle revolution (not for threading).',
    syntax: 'G95',
  },
  G96: {
    summary: 'Constant surface speed on lathe; S is speed, D optional max RPM.',
    syntax: 'G96 S (D) ($)',
  },
  G97: {
    summary: 'Spindle speed S is in RPM.',
    syntax: 'G97 S ($)',
  },
  G98: {
    summary: 'Canned cycles retract to the initial Z if it is above R.',
    syntax: 'G98',
  },
  G99: {
    summary: 'Canned cycles retract to the R plane.',
    syntax: 'G99',
  },
};

/** @type {Record<string, { summary: string; syntax: string }>} */
const m = {
  M0: {
    summary: 'Pauses the program until cycle start (optional stop behavior).',
    syntax: 'M0',
  },
  M1: {
    summary: 'Pauses only if the optional-stop switch is on.',
    syntax: 'M1',
  },
  M2: {
    summary: 'Ends the program and resets many modal states to defaults.',
    syntax: 'M2',
  },
  M30: {
    summary: 'Ends the program (pallet/rewind behavior per config); restart from top.',
    syntax: 'M30',
  },
  M60: {
    summary: 'Pallet exchange then pause; resume continues on the next line.',
    syntax: 'M60',
  },
  M3: {
    summary: 'Starts the selected spindle clockwise at the last S speed.',
    syntax: 'M3 ($)',
  },
  M4: {
    summary: 'Starts the selected spindle counterclockwise at the last S speed.',
    syntax: 'M4 ($)',
  },
  M5: {
    summary: 'Stops the selected spindle.',
    syntax: 'M5 ($)',
  },
  M6: {
    summary: 'Runs the tool change for the tool last selected with T.',
    syntax: 'M6  (after Tn)',
  },
  M7: { summary: 'Turns mist coolant on.', syntax: 'M7' },
  M8: { summary: 'Turns flood coolant on.', syntax: 'M8' },
  M9: { summary: 'Turns off mist and flood coolant.', syntax: 'M9' },
  M19: {
    summary: 'Orients the spindle to angle R with optional P direction and Q timeout.',
    syntax: 'M19 R (Q, P, $)',
  },
  M48: {
    summary: 'Enables feed and spindle speed override controls.',
    syntax: 'M48 ($)',
  },
  M49: {
    summary: 'Disables feed and spindle overrides.',
    syntax: 'M49 ($)',
  },
  M50: {
    summary: 'Enables or disables feed override via P1/P0.',
    syntax: 'M50 P0 | M50 P1',
  },
  M51: {
    summary: 'Enables or disables spindle speed override for the selected spindle.',
    syntax: 'M51 P0 | M51 P1 ($)',
  },
  M52: {
    summary: 'Enables or disables adaptive feed (motion.adaptive-feed).',
    syntax: 'M52 P0 | M52 P1',
  },
  M53: {
    summary: 'Allows feed-hold to stop motion when the pin is true.',
    syntax: 'M53 P0 | M53 P1',
  },
  M61: {
    summary: 'Sets the current tool number without a physical tool change.',
    syntax: 'M61 Q',
  },
  M62: {
    summary: 'Turns digital output P on at the start of the next motion.',
    syntax: 'M62 P',
  },
  M63: {
    summary: 'Turns digital output P off at the start of the next motion.',
    syntax: 'M63 P',
  },
  M64: {
    summary: 'Turns digital output P on immediately (not synced to motion).',
    syntax: 'M64 P',
  },
  M65: {
    summary: 'Turns digital output P off immediately (not synced to motion).',
    syntax: 'M65 P',
  },
  M66: {
    summary: 'Waits for a digital or analog input event; result in #5399.',
    syntax: 'M66 P | E (L, Q)',
  },
  M67: {
    summary: 'Sets analog output E to Q at the next motion.',
    syntax: 'M67 E Q',
  },
  M68: {
    summary: 'Sets analog output E to Q immediately.',
    syntax: 'M68 E Q',
  },
  M70: {
    summary: 'Saves modal G/M state at this call level for M72 restore.',
    syntax: 'M70',
  },
  M71: {
    summary: 'Invalidates the last M70/M73 save at this level.',
    syntax: 'M71',
  },
  M72: {
    summary: 'Restores modal state saved with M70.',
    syntax: 'M72',
  },
  M73: {
    summary: 'Saves modal state and auto-restores on subroutine return/endsub.',
    syntax: 'M73',
  },
  M98: {
    summary: 'Calls a Fanuc-style subprogram (see O-code / Fanuc programs).',
    syntax: 'M98 (see Fanuc-style programs in manual)',
  },
  M99: {
    summary: 'Returns from a subprogram or repeats the main program per usage.',
    syntax: 'M99 (see Fanuc-style programs in manual)',
  },
};

const data = JSON.parse(fs.readFileSync(refPath, 'utf8'));

for (const [k, v] of Object.entries(g)) {
  if (!data.g[k]) {
    console.warn('missing g key', k);
    continue;
  }
  data.g[k].summary = v.summary;
  data.g[k].syntax = v.syntax;
}

for (const [k, v] of Object.entries(m)) {
  if (!data.m[k]) {
    console.warn('missing m key', k);
    continue;
  }
  data.m[k].summary = v.summary;
  data.m[k].syntax = v.syntax;
}

validateAndApplyRelated(refPath, data);

fs.writeFileSync(refPath, `${JSON.stringify(data, null, 2)}\n`);
console.log('Wrote', refPath);
