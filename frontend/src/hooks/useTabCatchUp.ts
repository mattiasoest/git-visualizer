import { useCallback, useEffect, useRef, useState } from 'react';
import { BACKGROUND_CATCHUP_MS } from '../space/utils/constants';

export function useTabCatchUp() {
  const hiddenAtRef = useRef<number | null>(null);
  const [skipAnimations, setSkipAnimations] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }

      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt === null) return;

      if (Date.now() - hiddenAt >= BACKGROUND_CATCHUP_MS) {
        setSkipAnimations(true);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const clearSkipAnimations = useCallback(() => {
    setSkipAnimations(false);
  }, []);

  return { skipAnimations, clearSkipAnimations };
}
