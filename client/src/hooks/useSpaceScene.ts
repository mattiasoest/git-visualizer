import { useCallback, useEffect, useRef, useState } from 'react';
import { SpaceScene } from '../space/SpaceScene';

export function useSpaceScene(onGalaxyTap?: (archiveId: string) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const [autoRotating, setAutoRotating] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [sceneReady, setSceneReady] = useState(false);
  const onGalaxyTapRef = useRef(onGalaxyTap);
  onGalaxyTapRef.current = onGalaxyTap;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SpaceScene(container);
    sceneRef.current = scene;
    setSceneReady(true);
    scene.onGalaxyTap((archiveId) => {
      onGalaxyTapRef.current?.(archiveId);
    });
    setAutoRotating(scene.getAutoRotate());
    setLabelsVisible(scene.getLabelsVisible());
    const unsubscribeAutoRotate = scene.onAutoRotateChange(setAutoRotating);
    const unsubscribeLabels = scene.onLabelsVisibleChange(setLabelsVisible);

    let resizeRaf: number | null = null;

    const syncSize = () => {
      scene.resize();
    };

    const scheduleSync = () => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        syncSize();
      });
    };

    syncSize();

    const observer = new ResizeObserver(scheduleSync);
    observer.observe(container);

    const layoutTargets = [
      container.parentElement,
      container.parentElement?.parentElement,
    ];
    for (const target of layoutTargets) {
      if (target) observer.observe(target);
    }

    window.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);

    return () => {
      unsubscribeAutoRotate();
      unsubscribeLabels();
      observer.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      scene.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
  }, []);

  const toggleLabels = useCallback(() => {
    sceneRef.current?.setLabelsVisible(!labelsVisible);
  }, [labelsVisible]);

  const resumeAutoRotate = useCallback(() => {
    sceneRef.current?.setAutoRotate(true);
  }, []);

  return {
    containerRef,
    sceneRef,
    autoRotating,
    labelsVisible,
    toggleLabels,
    resumeAutoRotate,
    sceneReady,
  };
}
