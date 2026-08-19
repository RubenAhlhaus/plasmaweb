import type { MacroParams } from '@/types/macros';
import i18n from '@/i18n/config';

type PatternBlockLabelParams = {
  name?: MacroParams[string];
};

/**
 * Display name of a nested pattern block (`kind: 'pattern'`) from `params.name`
 * (e.g. queue and “Next macro …” hint).
 */
export function patternQueueDisplayLabel(params: PatternBlockLabelParams): string {
  const n = String(params.name ?? '').trim();
  if (n) return n;
  return i18n.t('queue.patternFallback', { ns: 'macros' });
}
