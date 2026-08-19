/** Shared E2E browser / preview settings (Playwright + fixtures). */
export const E2E_VIEWPORT = { width: 1920, height: 1080 } as const;

export const E2E_PREVIEW_HOST = process.env.E2E_PREVIEW_HOST ?? '127.0.0.1';
export const E2E_PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT ?? 4173);

export const E2E_PREVIEW_URL = `http://${E2E_PREVIEW_HOST}:${E2E_PREVIEW_PORT}`;
