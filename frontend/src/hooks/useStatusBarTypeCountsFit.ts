import { useLayoutEffect, useRef, useState } from 'react';

function readHorizontalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
}

function readViewportWidth(): number {
  return window.visualViewport?.width ?? window.innerWidth;
}

function isTypeCountsWrapped(left: HTMLElement, counts: HTMLElement): boolean {
  const leftRect = left.getBoundingClientRect();
  const countsRect = counts.getBoundingClientRect();
  return countsRect.top > leftRect.top + 1;
}

export function useStatusBarTypeCountsFit(contentKey: string) {
  const footerRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const countsRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [fitsOnOneLine, setFitsOnOneLine] = useState(false);
  const [typeCountsWrapped, setTypeCountsWrapped] = useState(false);

  useLayoutEffect(() => {
    const syncViewportWidth = () => {
      setViewportWidth((current) => {
        const next = readViewportWidth();
        return current === next ? current : next;
      });
    };

    window.addEventListener('resize', syncViewportWidth);
    window.visualViewport?.addEventListener('resize', syncViewportWidth);

    return () => {
      window.removeEventListener('resize', syncViewportWidth);
      window.visualViewport?.removeEventListener('resize', syncViewportWidth);
    };
  }, []);

  useLayoutEffect(() => {
    let outerRaf = 0;
    let innerRaf = 0;

    const measure = () => {
      const footer = footerRef.current;
      const probe = measureRef.current;
      const left = leftRef.current;
      const counts = countsRef.current;

      if (footer && probe) {
        const available = viewportWidth - readHorizontalPadding(footer);
        const needed = probe.scrollWidth;
        setFitsOnOneLine(needed <= available + 0.5);
      }

      if (left && counts) {
        const wrapped = isTypeCountsWrapped(left, counts);
        setTypeCountsWrapped((current) =>
          current === wrapped ? current : wrapped,
        );
      } else {
        setTypeCountsWrapped((current) => (current ? false : current));
      }
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      outerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(measure);
      });
    };

    scheduleMeasure();

    const observer = new ResizeObserver(scheduleMeasure);
    if (footerRef.current) observer.observe(footerRef.current);

    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      observer.disconnect();
    };
  }, [contentKey, viewportWidth, fitsOnOneLine]);

  return {
    footerRef,
    leftRef,
    countsRef,
    measureRef,
    fitsOnOneLine,
    typeCountsWrapped,
  };
}
