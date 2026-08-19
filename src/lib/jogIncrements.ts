export type ParsedJogIncrement = {
  label: string;
  valueMu: number;
};

/** Maximum increment buttons shown in IncrementSelector (plus Continuous). */
export const MAX_JOG_INCREMENT_BUTTONS = 4;

const UNIT_FACTORS_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  um: 0.001,
  inch: 25.4,
  in: 25.4,
  mil: 0.0254,
};

const GLUED_UNIT_SUFFIX = /(inch|mil|mm|cm|um|in)$/i;

function parseNumericValue(valuePart: string): number | null {
  if (!valuePart) return null;

  if (valuePart.includes('/')) {
    const [num, den] = valuePart.split('/').map((v) => Number(v.replace(',', '.')));
    if (!den || Number.isNaN(num) || Number.isNaN(den)) return null;
    return num / den;
  }

  const numeric = Number(valuePart.replace(',', '.'));
  return Number.isNaN(numeric) ? null : numeric;
}

function splitValueAndUnit(trimmed: string): { valuePart: string; unitPart: string } {
  const spaceParts = trimmed.split(/\s+/);
  if (spaceParts.length >= 2) {
    return {
      valuePart: spaceParts[0] ?? '',
      unitPart: spaceParts.slice(1).join('').toLowerCase(),
    };
  }

  const gluedMatch = trimmed.match(new RegExp(`^(.+?)${GLUED_UNIT_SUFFIX.source}$`, 'i'));
  if (gluedMatch) {
    return {
      valuePart: gluedMatch[1] ?? '',
      unitPart: (gluedMatch[2] ?? '').toLowerCase(),
    };
  }

  return { valuePart: trimmed, unitPart: '' };
}

function parseSingleJogIncrement(raw: string): ParsedJogIncrement | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const { valuePart, unitPart } = splitValueAndUnit(trimmed);
  const numeric = parseNumericValue(valuePart);
  if (numeric === null) return null;

  const factor = unitPart ? (UNIT_FACTORS_MM[unitPart] ?? 1) : 1;

  return {
    label: trimmed,
    valueMu: numeric * factor,
  };
}

function tokenizeIncrementsSpec(spec: string): string[] {
  const trimmed = spec.trim();
  if (!trimmed) return [];

  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  if (tokens.every((token) => parseSingleJogIncrement(token) !== null)) {
    return tokens;
  }

  const paired: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    if (i + 1 < tokens.length) {
      const candidate = `${tokens[i]} ${tokens[i + 1]}`;
      if (parseSingleJogIncrement(candidate) !== null) {
        paired.push(candidate);
        i += 2;
        continue;
      }
    }
    paired.push(tokens[i] ?? '');
    i += 1;
  }
  return paired;
}

export function parseJogIncrementsSpec(
  spec: string,
  maxCount: number = MAX_JOG_INCREMENT_BUTTONS,
): ParsedJogIncrement[] {
  return tokenizeIncrementsSpec(spec)
    .slice(0, maxCount)
    .map((s) => parseSingleJogIncrement(s))
    .filter((x): x is ParsedJogIncrement => x !== null);
}

/** Converts an increment button label to machine units (mm); throws when unparseable. */
export function parseJogIncrementLabelToMm(rawLabel: string): number {
  const parsed = parseSingleJogIncrement(rawLabel);
  if (!parsed) {
    throw new Error(`parseJogIncrementLabelToMm: invalid label: "${rawLabel}"`);
  }
  return parsed.valueMu;
}
