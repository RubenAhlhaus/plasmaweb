import { useTranslation } from 'react-i18next';

type PlaceholderScreenProps = {
  titleKey: string;
  descriptionKey?: string;
};

export function PlaceholderScreen({ titleKey, descriptionKey = 'placeholder.emptyArea' }: PlaceholderScreenProps) {
  const { t } = useTranslation('common');
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      data-e2e="screen-placeholder"
    >
      <div className="px-10 py-6 rounded-2xl border border-border/40 bg-slate-900/70 shadow-xl text-center">
        <div className="text-2xl font-semibold text-foreground/90 mb-2">{t(titleKey)}</div>
        <div className="text-sm text-foreground/60">{t(descriptionKey)}</div>
      </div>
    </div>
  );
}

