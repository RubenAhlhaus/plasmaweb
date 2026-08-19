import { useTranslation } from 'react-i18next';

/** Notice when hole X/Y and surface Z come from a parent drill pattern (fields hidden). */
export function MacroFromPatternHint() {
  const { t } = useTranslation('macros');
  return (
    <p
      className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
      role="status"
      data-e2e="macros-from-pattern-hint"
    >
      {t('dialog.fromPatternHint')}
    </p>
  );
}
