import {
  LINUXCNC_GCODE_DOC_URL,
  LINUXCNC_MCODE_DOC_URL,
  lookupCodeReference,
  type LinuxCncRelatedCode,
} from '@/utils/linuxCncCodeReference';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FALLBACK =
  'This code is not covered by the bundled LinuxCNC reference excerpt. See the official G-code and M-code manuals for full details.';

const relatedChipButtonClassName =
  'rounded px-1 py-0.5 font-mono tabular-nums text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:bg-muted/70 hover:decoration-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type GmReferenceKind = 'g' | 'm';

function GmRelatedCodesList({
  related,
  compact,
  onSelect,
}: {
  related: LinuxCncRelatedCode[];
  compact?: boolean;
  onSelect?: (kind: GmReferenceKind, code: string) => void;
}) {
  if (related.length === 0) {
    return null;
  }

  const headingClass = cn(
    'font-semibold uppercase tracking-wide text-muted-foreground mb-1',
    compact ? 'text-[10px]' : 'text-xs',
  );
  const rowText = compact ? 'text-[11px]' : 'text-xs';

  return (
    <div>
      <p className={headingClass}>Related codes</p>
      <ul className="space-y-1.5 list-none pl-0 m-0">
        {related.map((r, i) => (
          <li
            key={`${r.kind}:${r.code}:${i}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(r.kind, r.code)}
                className={cn('inline-flex shrink-0', rowText, relatedChipButtonClassName)}
              >
                {r.code}
              </button>
            ) : (
              <span
                className={cn(
                  'inline-flex shrink-0 font-mono tabular-nums',
                  r.kind === 'm' ? 'text-rose-300/95' : 'text-sky-300/95',
                  rowText,
                )}
              >
                {r.code}
              </span>
            )}
            {r.hint ? (
              <span className={cn('text-muted-foreground min-w-0', rowText)}>{r.hint}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type GmCodeReferenceBodyProps = {
  kind: GmReferenceKind;
  label: string;
  /** Optional slot below related codes. */
  children?: React.ReactNode;
  /** Tighter spacing for popover / strip. */
  compact?: boolean;
  className?: string;
  /** When set, related codes are buttons (e.g. Active codes dialog). */
  onRelatedCodeSelect?: (kind: GmReferenceKind, code: string) => void;
};

export function gmManualUrl(kind: GmReferenceKind): string {
  return kind === 'm' ? LINUXCNC_MCODE_DOC_URL : LINUXCNC_GCODE_DOC_URL;
}

export function GmCodeReferenceBody({
  kind,
  label,
  children,
  compact,
  className,
  onRelatedCodeSelect,
}: GmCodeReferenceBodyProps) {
  const ref = lookupCodeReference(kind, label);
  const summary = ref?.summary ?? ref?.description ?? FALLBACK;
  const syntax = ref?.syntax ?? null;
  const related = ref?.related?.length ? ref.related : null;

  const gap = compact ? 'space-y-2' : 'space-y-3';
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={cn(gap, textSize, 'leading-relaxed', className)}>
      <p className="text-foreground">{summary}</p>
      {syntax ? (
        <div>
          <p
            className={cn(
              'font-semibold uppercase tracking-wide text-muted-foreground mb-1',
              compact ? 'text-[10px]' : 'text-xs',
            )}
          >
            Syntax
          </p>
          <p className="font-mono text-foreground break-words">{syntax}</p>
        </div>
      ) : null}
      {related ? (
        <GmRelatedCodesList
          related={related}
          compact={compact}
          onSelect={onRelatedCodeSelect}
        />
      ) : null}
      {children}
    </div>
  );
}

export function GmCodeManualLink({
  kind,
  className,
}: {
  kind: GmReferenceKind;
  className?: string;
}) {
  return (
    <a
      href={gmManualUrl(kind)}
      target="_blank"
      rel="noreferrer"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)}
    >
      LinuxCNC manual
    </a>
  );
}

export type { LinuxCncRelatedCode } from '@/utils/linuxCncCodeReference';
