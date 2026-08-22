import { useEffect, useState } from 'react';

import { formatForViewport, type PlasmaScreenFormat } from '@/lib/plasmaScreenFormat';

/**
 * The screen format this viewport is, kept current as it changes.
 *
 * Also stamped on the document root as `data-screen-format`, so styling can key off the
 * format without every component being handed it — the same way upstream's three screens are
 * one decision made once rather than a condition in every panel.
 */
export function usePlasmaScreenFormat(): PlasmaScreenFormat {
  const [format, setFormat] = useState<PlasmaScreenFormat>(() =>
    typeof window === 'undefined'
      ? 'wide'
      : formatForViewport(window.innerWidth, window.innerHeight),
  );

  useEffect(() => {
    const update = () => setFormat(formatForViewport(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener('resize', update);
    // An orientation change on a panel PC fires before the new size is readable in some
    // browsers, so the resize that follows it is what actually settles the format.
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-screen-format', format);
    return () => document.documentElement.removeAttribute('data-screen-format');
  }, [format]);

  return format;
}
