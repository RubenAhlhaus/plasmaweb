/** Categories for syntax highlighting (letter → semantic group). */
export type GcodeTokenKind =
  | 'comment'
  | 'motion'
  | 'misc'
  | 'feed'
  | 'spindle'
  | 'tool'
  | 'axis'
  | 'param'
  | 'hash'
  | 'plain';

/** For words (F/X/… + number): letter and value split; G/M without `part` (one command). */
export type GcodeWordPart = 'letter' | 'value';

export type GcodeSegment = {
  text: string;
  kind: GcodeTokenKind;
  part?: GcodeWordPart;
};

function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r';
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/** Reads optional sign + integer/decimal from `start`; `end === start` if no number. */
function readNumericEnd(line: string, start: number, len: number): number {
  let j = start;
  if (j < len && (line[j] === '-' || line[j] === '+')) {
    j += 1;
  }
  if (j >= len) {
    return start;
  }
  if (line[j] === '.') {
    j += 1;
    const decStart = j;
    while (j < len && isDigit(line[j])) {
      j += 1;
    }
    return j > decStart ? j : start;
  }
  if (!isDigit(line[j])) {
    return start;
  }
  while (j < len && isDigit(line[j])) {
    j += 1;
  }
  if (j < len && line[j] === '.') {
    j += 1;
    while (j < len && isDigit(line[j])) {
      j += 1;
    }
  }
  return j;
}

/** `u` = single letter already uppercased (e.g. `ch.toUpperCase()`). */
function letterKindForUpperLetter(u: string): GcodeTokenKind {
  if (u === 'G') return 'motion';
  if (u === 'M') return 'misc';
  if (u === 'F') return 'feed';
  if (u === 'S') return 'spindle';
  if (u === 'T') return 'tool';
  if ('XYZABCUVW'.includes(u)) return 'axis';
  return 'param';
}

/**
 * Tokenize one G-code line for highlighting.
 * Comments: `(...)` (no nested parens), `;` to end of line.
 * Words: one letter, optional whitespace, numeric value. `#` + digits = parameter.
 * **G** and **M** with number: one segment without `part` (letter, optional whitespace and number
 * together — one command). Other letter words: `part` `letter` / `value` as before.
 */
export function tokenizeGcodeLine(line: string): GcodeSegment[] {
  const out: GcodeSegment[] = [];
  const len = line.length;
  let i = 0;

  const push = (text: string, kind: GcodeTokenKind, part?: GcodeWordPart) => {
    if (text.length > 0) {
      out.push(part !== undefined ? { text, kind, part } : { text, kind });
    }
  };

  while (i < len) {
    const ch = line.charAt(i);

    if (ch === ';') {
      push(line.slice(i), 'comment');
      break;
    }

    if (ch === '(') {
      const close = line.indexOf(')', i + 1);
      if (close === -1) {
        push(line.slice(i), 'comment');
        break;
      }
      push(line.slice(i, close + 1), 'comment');
      i = close + 1;
      continue;
    }

    if (isWhitespace(ch)) {
      let j = i + 1;
      while (j < len && isWhitespace(line.charAt(j))) {
        j += 1;
      }
      push(line.slice(i, j), 'plain');
      i = j;
      continue;
    }

    if (ch === '#') {
      let j = i + 1;
      while (j < len && isDigit(line.charAt(j))) {
        j += 1;
      }
      if (j > i + 1) {
        push('#', 'hash', 'letter');
        push(line.slice(i + 1, j), 'hash', 'value');
        i = j;
      } else {
        push(ch, 'plain');
        i += 1;
      }
      continue;
    }

    if (isLetter(ch)) {
      let k = i + 1;
      while (k < len && isWhitespace(line.charAt(k))) {
        k += 1;
      }
      const numEnd = readNumericEnd(line, k, len);
      if (numEnd > k) {
        const u = ch.toUpperCase();
        const wk = letterKindForUpperLetter(u);
        if (u === 'G' || u === 'M') {
          push(line.slice(i, numEnd), wk);
        } else {
          push(ch, wk, 'letter');
          if (k > i + 1) {
            push(line.slice(i + 1, k), 'plain');
          }
          push(line.slice(k, numEnd), wk, 'value');
        }
        i = numEnd;
      } else {
        push(ch, 'plain');
        i += 1;
      }
      continue;
    }

    push(ch, 'plain');
    i += 1;
  }

  return out;
}

/** Full program text: each line tokenized, newlines as `plain`. */
export function tokenizeGcode(source: string): GcodeSegment[] {
  if (source === '') {
    return [];
  }
  const parts = source.split('\n');
  const out: GcodeSegment[] = [];
  let firstLine = true;
  for (const linePart of parts) {
    if (!firstLine) {
      out.push({ text: '\n', kind: 'plain' });
    }
    firstLine = false;
    out.push(...tokenizeGcodeLine(linePart));
  }
  return out;
}
