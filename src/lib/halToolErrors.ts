import type { TFunction } from 'i18next';
import { HAL_TOOL_ERROR_CODES, type HalToolErrorCode, type HalToolId } from '@/lib/halToolsApi';

const HAL_TOOL_ERROR_CODE_SET = new Set<string>(HAL_TOOL_ERROR_CODES);

export function isHalToolErrorCode(code: string | undefined): code is HalToolErrorCode {
  return code != null && HAL_TOOL_ERROR_CODE_SET.has(code);
}

export function halToolLaunchErrorMessage(
  t: TFunction<['settings']>,
  tool: HalToolId,
  code?: string,
  fallbackMessage?: string,
): string {
  if (isHalToolErrorCode(code)) {
    return t(`settings:halTools.errors.${code}`, {
      tool: t(`settings:halTools.tools.${tool}`),
    });
  }
  if (fallbackMessage != null && fallbackMessage.length > 0) {
    return fallbackMessage;
  }
  return t('settings:halTools.launchFailed', {
    tool: t(`settings:halTools.tools.${tool}`),
  });
}
