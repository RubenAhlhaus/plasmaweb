import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

import i18n, { i18nReady } from '@/i18n/config';

beforeEach(async () => {
  await i18nReady;
  await i18n.changeLanguage('en');
});

