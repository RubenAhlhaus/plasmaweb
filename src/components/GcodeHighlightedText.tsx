import { GmCodeHoverSpan } from '@/components/GmCodeHoverSpan';
import { cn } from '@/lib/utils';
import { gmLookupKeyFromTokenText } from '@/utils/gmCodeLookupFromText';
import {
  tokenizeGcode,
  tokenizeGcodeLine,
  type GcodeTokenKind,
  type GcodeWordPart,
} from '@/utils/gcodeSyntax';

/** Einheitliches Grau für Zahlenteile bei F/X/… (G/M-Zahlen sind mit dem Buchstaben eine Farbe). */
const GC_WORD_VALUE_CLASS = 'text-slate-400';

function classForWordPart(
  kind: GcodeTokenKind,
  part: GcodeWordPart,
): string {
  if (part === 'value') {
    return GC_WORD_VALUE_CLASS;
  }
  switch (kind) {
    case 'motion':
      return 'text-sky-400';
    case 'axis':
      return 'text-amber-400';
    case 'misc':
      return 'text-rose-400';
    case 'feed':
      return 'text-emerald-400';
    case 'spindle':
      return 'text-orange-400';
    case 'tool':
      return 'text-violet-400';
    case 'param':
      return 'text-yellow-400';
    case 'hash':
      return 'text-fuchsia-400';
    default:
      return 'text-foreground';
  }
}

export function gcodeTokenClassName(
  kind: GcodeTokenKind,
  options?: { plainInherit?: boolean; part?: GcodeWordPart },
): string {
  if (kind === 'plain' && options?.plainInherit) {
    return 'text-inherit';
  }
  if (options?.part !== undefined) {
    return classForWordPart(kind, options.part);
  }
  switch (kind) {
    case 'comment':
      return 'text-slate-500';
    case 'motion':
      return 'text-sky-400';
    case 'misc':
      return 'text-rose-400';
    case 'feed':
      return 'text-emerald-400';
    case 'spindle':
      return 'text-orange-400';
    case 'tool':
      return 'text-violet-400';
    case 'axis':
      return 'text-amber-400';
    case 'param':
      return 'text-yellow-400/90';
    case 'hash':
      return 'text-fuchsia-400';
    case 'plain':
    default:
      return 'text-foreground';
  }
}

type GcodeHighlightedTextProps = {
  text: string;
  /** Mehrzeilig (Programmeditor); sonst eine MDI-Zeile. */
  multiline?: boolean;
  /** z. B. aktuelle Zeile mit `text-primary-foreground`: neutrale Token erben die Zeilenfarbe. */
  plainInherit?: boolean;
  /** G- und M-Wörter mit Referenz-Popup (nur sinnvoll bei klick-/hover-fähigen Flächen). */
  gmHover?: boolean;
  className?: string;
};

export function GcodeHighlightedText({
  text,
  multiline = false,
  plainInherit = false,
  gmHover = false,
  className,
}: GcodeHighlightedTextProps) {
  const segments = multiline ? tokenizeGcode(text) : tokenizeGcodeLine(text);
  if (segments.length === 0) {
    return null;
  }
  const plainOptsBase = plainInherit ? { plainInherit: true as const } : {};
  return (
    <span className={cn(multiline && 'whitespace-pre-wrap break-words', className)}>
      {segments.map((seg, i) => {
        const tokenClass = gcodeTokenClassName(seg.kind, {
          ...plainOptsBase,
          ...(seg.part !== undefined ? { part: seg.part } : {}),
        });
        const gmKey =
          gmHover && seg.part === undefined
            ? gmLookupKeyFromTokenText(seg.text)
            : null;
        if (gmKey) {
          return (
            <GmCodeHoverSpan
              key={i}
              kind={gmKey.kind}
              label={gmKey.label}
              className={tokenClass}
            >
              {seg.text}
            </GmCodeHoverSpan>
          );
        }
        return (
          <span
            key={i}
            className={tokenClass}
          >
            {seg.text}
          </span>
        );
      })}
    </span>
  );
}
