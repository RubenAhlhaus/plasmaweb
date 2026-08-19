import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import {
  MACHINE_TWO_COLUMN_MIN_WIDTH_PX,
  measureJogControlSizeFromElement,
  type JogControlSize,
} from '@/lib/jogControlSize';

const twoColumnMediaQuery = `(min-width: ${MACHINE_TWO_COLUMN_MIN_WIDTH_PX}px)`;

export function useJogPanelSize(
  panelRef: RefObject<HTMLElement | null>,
): JogControlSize {
  const [size, setSize] = useState<JogControlSize>(() => {
    const element = panelRef.current;
    if (!element) {
      return 'compact';
    }
    return measureJogControlSizeFromElement(element);
  });

  useEffect(() => {
    const element = panelRef.current;
    if (!element) {
      return;
    }

    const twoColumnQuery = window.matchMedia(twoColumnMediaQuery);

    const update = () => {
      requestAnimationFrame(() => {
        setSize(measureJogControlSizeFromElement(element));
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    twoColumnQuery.addEventListener('change', update);

    return () => {
      observer.disconnect();
      twoColumnQuery.removeEventListener('change', update);
    };
  }, [panelRef]);

  return size;
}
