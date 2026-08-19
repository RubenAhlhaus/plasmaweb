import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { MacroHintGraphic } from '@/components/macros/MacroHintGraphic';
import { MacroParamSectionHeadingOptional } from '@/components/macros/MacroParamSectionHeading';
import type { MacroHintDefinition } from '@/data/macroHintDefinitions';
import type { MacroParamSection } from '@/types/macros';
import { cn } from '@/lib/utils';

/** Hint graphic shown beside the touch-numeric sub-dialog (`dialogAside`). */
export function useMacroDialogAside(
  hintDefinition: MacroHintDefinition | null,
  activeHintKey: string | null,
  hintAriaLabel: string,
) {
  return useMemo(() => {
    if (!hintDefinition) return null;
    return (
      <MacroHintGraphic
        key={hintDefinition.svgPath}
        svgPath={hintDefinition.svgPath}
        ariaLabel={hintAriaLabel}
        activeKey={activeHintKey}
        className="h-auto w-full max-h-[min(20rem,36vh)]"
      />
    );
  }, [activeHintKey, hintDefinition, hintAriaLabel]);
}

type MacroParamFieldsLayoutProps = {
  hintDefinition: MacroHintDefinition | null;
  activeHintKey: string | null;
  hintAriaLabel: string;
  sections: MacroParamSection[];
  sectionKeyPrefix: string;
  renderField: (key: string) => ReactNode;
  sectionHeading: (headingKey: string) => string;
  /** Optional notice above the field sections (e.g. nested `MacroFromPatternHint`). */
  banner?: ReactNode;
};

export function MacroParamFieldsLayout({
  hintDefinition,
  activeHintKey,
  hintAriaLabel,
  sections,
  sectionKeyPrefix,
  renderField,
  sectionHeading,
  banner,
}: MacroParamFieldsLayoutProps) {
  return (
    <div
      className={cn(
        'grid gap-6',
        hintDefinition ? 'grid-cols-1 lg:[grid-template-columns:var(--macro-hint-sidebar)_minmax(0,1fr)]' : 'grid-cols-1',
      )}
      style={
        hintDefinition
          ? ({ ['--macro-hint-sidebar' as string]: hintDefinition.sidebarWidthClass } as CSSProperties)
          : undefined
      }
    >
      {hintDefinition ? (
        <aside
          className="mx-auto w-full rounded-md border border-border/60 bg-muted/20 p-2 lg:mx-0"
          style={{ maxWidth: hintDefinition.sidebarWidthClass }}
        >
          <MacroHintGraphic
            key={hintDefinition.svgPath}
            svgPath={hintDefinition.svgPath}
            ariaLabel={hintAriaLabel}
            activeKey={activeHintKey}
            className="h-auto w-full"
          />
        </aside>
      ) : null}

      <div className="space-y-6">
        {banner}
        {sections.map((section, si) => {
          const nodes = section.keys.map((k) => renderField(k)).filter(Boolean);
          if (nodes.length === 0) return null;
          return (
            <div key={`${sectionKeyPrefix}-${si}`} className="space-y-3">
              <MacroParamSectionHeadingOptional title={sectionHeading(section.headingKey)} />
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">{nodes}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
