import { useTranslation } from 'react-i18next';

/** Shown while a lazy-loaded screen chunk is loading (Settings, Macros, …). */
export function ScreenLoadingFallback() {
  const { t } = useTranslation('common');

  return (
    <div
      className="flex h-full min-h-[12rem] items-center justify-center text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {t('screenLoading')}
    </div>
  );
}
