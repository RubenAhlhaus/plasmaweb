/**
 * Safe evaluation of arithmetic expressions (+ - * /), parentheses, unary minus.
 * No eval(). Comma is accepted as decimal separator inside numbers.
 */

type Token =
  | { t: 'num'; v: number }
  | { t: '+' }
  | { t: '-' }
  | { t: '*' }
  | { t: '/' }
  | { t: '(' }
  | { t: ')' }
  | { t: 'eof' };

function preprocess(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

function readNumber(s: string, start: number): { value: number; end: number } | null {
  let i = start;
  let sepSeen = false;
  if (i < s.length && s[i] === '.') {
    sepSeen = true;
    i++;
  } else if (i >= s.length || s[i] < '0' || s[i] > '9') {
    return null;
  }

  while (i < s.length) {
    const c = s[i];
    if (c >= '0' && c <= '9') {
      i++;
      continue;
    }
    if ((c === '.' || c === ',') && !sepSeen) {
      sepSeen = true;
      i++;
      continue;
    }
    break;
  }

  let slice = s.slice(start, i);
  if (slice.endsWith('.') || slice.endsWith(',')) {
    slice = slice.slice(0, -1);
    i--;
  }
  slice = slice.replace(',', '.');
  if (slice === '' || slice === '.' || (slice.startsWith('.') && slice.length === 1))
    return null;
  const parts = slice.split('.');
  if (parts.length > 2) return null;

  const v = Number(slice);
  if (!Number.isFinite(v)) return null;
  return { value: v, end: i };
}

function tokenize(s: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  const n = s.length;

  while (i < n) {
    const c = s[i];
    if (c === '(') {
      out.push({ t: '(' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ t: ')' });
      i++;
      continue;
    }
    if (c === '+') {
      out.push({ t: '+' });
      i++;
      continue;
    }
    if (c === '*') {
      out.push({ t: '*' });
      i++;
      continue;
    }
    if (c === '/') {
      out.push({ t: '/' });
      i++;
      continue;
    }
    if (c === '-') {
      out.push({ t: '-' });
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.' || c === ',') {
      const num = readNumber(s, i);
      if (!num) return null;
      out.push({ t: 'num', v: num.value });
      i = num.end;
      continue;
    }
    return null;
  }

  out.push({ t: 'eof' });
  return out;
}

class Parser {
  private i = 0;

  constructor(private readonly toks: Token[]) {}

  private peek(): Token {
    return this.toks[this.i] ?? { t: 'eof' };
  }

  private next(): Token {
    return this.toks[this.i++] ?? { t: 'eof' };
  }

  parse(): number | null {
    const v = this.parseExpr();
    if (v === null) return null;
    if (this.peek().t !== 'eof') return null;
    return v;
  }

  private parseExpr(): number | null {
    let left = this.parseTerm();
    if (left === null) return null;
    for (;;) {
      const p = this.peek();
      if (p.t !== '+' && p.t !== '-') break;
      this.next();
      const right = this.parseTerm();
      if (right === null) return null;
      left = p.t === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number | null {
    let left = this.parseUnary();
    if (left === null) return null;
    for (;;) {
      const p = this.peek();
      if (p.t !== '*' && p.t !== '/') break;
      this.next();
      const right = this.parseUnary();
      if (right === null) return null;
      if (p.t === '/') {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private parseUnary(): number | null {
    if (this.peek().t === '-') {
      this.next();
      const v = this.parseUnary();
      return v === null ? null : -v;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number | null {
    const p = this.peek();
    if (p.t === 'num') {
      this.next();
      return p.v;
    }
    if (p.t === '(') {
      this.next();
      const inner = this.parseExpr();
      if (inner === null) return null;
      if (this.peek().t !== ')') return null;
      this.next();
      return inner;
    }
    return null;
  }
}

/**
 * Evaluates a numeric expression string. Returns null if invalid or division by zero.
 */
export function evaluateNumericExpression(raw: string): number | null {
  const s = preprocess(raw);
  if (s === '') return null;

  const tokens = tokenize(s);
  if (!tokens) return null;

  const parser = new Parser(tokens);
  const result = parser.parse();
  if (result === null || !Number.isFinite(result)) return null;
  return result;
}

/**
 * Trim + evaluate; use when committing dialog input.
 */
export function parseTouchNumericForCommit(text: string): number | null {
  return evaluateNumericExpression(text);
}

/** Evaluate expression, round to integer; invalid or negative → `null` (for spindle S, etc.). */
export function parseUnsignedIntFromNumericExpression(raw: string): number | null {
  const r = evaluateNumericExpression(raw.trim());
  if (r === null || !Number.isFinite(r)) return null;
  const n = Math.round(r);
  if (n < 0) return null;
  return n;
}

/** Like {@link parseUnsignedIntFromNumericExpression}, value must be **> 0** (for feed F). */
export function parsePositiveIntFromNumericExpression(raw: string): number | null {
  const n = parseUnsignedIntFromNumericExpression(raw);
  if (n === null || n <= 0) return null;
  return n;
}
