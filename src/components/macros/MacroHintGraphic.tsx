import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type MacroHintGraphicProps = {
  svgPath: string;
  activeKey: string | null;
  className?: string;
  ariaLabel: string;
};

const svgTextCache = new Map<string, string>();
const svgInflight = new Map<string, Promise<string | null>>();

function loadSvgTextCached(path: string): Promise<string | null> {
  const cached = svgTextCache.get(path);
  if (cached !== undefined) return Promise.resolve(cached);

  const inflight = svgInflight.get(path);
  if (inflight) return inflight;

  const p = fetch(path)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error('SVG load failed'))))
    .then((text) => {
      svgTextCache.set(path, text);
      return text;
    })
    .catch(() => null)
    .finally(() => {
      svgInflight.delete(path);
    });

  svgInflight.set(path, p);
  return p;
}

function applySvgPresentation(svg: SVGSVGElement, activeKey: string | null, className: string | undefined, ariaLabel: string) {
  svg.setAttribute('data-active', activeKey ?? '');
  if (className) svg.setAttribute('class', className);
  else svg.removeAttribute('class');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);
}

export function MacroHintGraphic({ svgPath, activeKey, className, ariaLabel }: MacroHintGraphicProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<string | null>(null);
  const [svgTemplate, setSvgTemplate] = useState<string | null>(() => svgTextCache.get(svgPath) ?? null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    templateRef.current = null;
    const cached = svgTextCache.get(svgPath);
    if (cached !== undefined) {
      setSvgTemplate(cached);
    } else {
      setSvgTemplate(null);
    }
    loadSvgTextCached(svgPath).then((text) => {
      if (!alive) return;
      if (text == null) {
        setLoadFailed(true);
        setSvgTemplate(null);
        return;
      }
      setSvgTemplate(text);
    });
    return () => {
      alive = false;
    };
  }, [svgPath]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    if (loadFailed || svgTemplate == null) {
      el.replaceChildren();
      templateRef.current = null;
      return;
    }

    const existing = el.firstElementChild;
    const sameTemplate = templateRef.current === svgTemplate;
    const svgOk = existing instanceof SVGSVGElement;

    if (sameTemplate && svgOk) {
      applySvgPresentation(existing, activeKey, className, ariaLabel);
      return;
    }

    const doc = new DOMParser().parseFromString(svgTemplate, 'image/svg+xml');
    if (doc.querySelector('parsererror')) {
      el.replaceChildren();
      templateRef.current = null;
      setLoadFailed(true);
      setSvgTemplate(null);
      return;
    }

    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') {
      el.replaceChildren();
      templateRef.current = null;
      setLoadFailed(true);
      setSvgTemplate(null);
      return;
    }

    const svg = root.cloneNode(true) as SVGSVGElement;
    applySvgPresentation(svg, activeKey, className, ariaLabel);
    el.replaceChildren(svg);
    templateRef.current = svgTemplate;
  }, [activeKey, ariaLabel, className, loadFailed, svgTemplate]);

  if (loadFailed) {
    return <img src={svgPath} alt={ariaLabel} className={className} />;
  }

  return <div ref={wrapRef} className="w-full min-h-[1px]" />;
}
