import type { ReactNode } from 'react';

export const macroParamSectionHeadingClass =
  'text-xs font-semibold uppercase tracking-wide text-muted-foreground';

export function MacroParamSectionHeading({ children }: { children: ReactNode }) {
  return <h3 className={macroParamSectionHeadingClass}>{children}</h3>;
}

/** Nur rendern, wenn `title` nach trim nicht leer ist (Fallback-Abschnitte ohne sichtbare Zeile). */
export function MacroParamSectionHeadingOptional({ title }: { title: string }) {
  const t = title.trim();
  if (!t) return null;
  return <MacroParamSectionHeading>{t}</MacroParamSectionHeading>;
}
