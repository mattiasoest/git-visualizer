import { useEffect } from 'react';

function syncViewportHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}

export function useViewportHeight(): void {
  useEffect(() => {
    syncViewportHeight();

    window.addEventListener('resize', syncViewportHeight);
    window.visualViewport?.addEventListener('resize', syncViewportHeight);
    window.visualViewport?.addEventListener('scroll', syncViewportHeight);

    return () => {
      window.removeEventListener('resize', syncViewportHeight);
      window.visualViewport?.removeEventListener('resize', syncViewportHeight);
      window.visualViewport?.removeEventListener('scroll', syncViewportHeight);
    };
  }, []);
}
