import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import {
  buildGraph,
  graphDataFingerprint,
  groupedEventNodeId,
  MAX_GRAPH_EVENTS,
  type GraphData,
} from './space/graphBuilder';
import { SpaceScene } from './space/SpaceScene';

interface SpaceVisualizationProps {
  events: EventView[];
  activeTypes: Set<string>;
  onEventCountChange?: (count: number) => void;
}

export function SpaceVisualization({ events, activeTypes, onEventCountChange }: SpaceVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const seenEventIds = useRef<Set<string>>(new Set());
  const graphDataRef = useRef<GraphData>({ nodes: [], links: [] });
  const fingerprintRef = useRef('');
  const [autoRotating, setAutoRotating] = useState(true);

  const filteredEvents = useMemo(() => {
    const filtered = events.filter((event) => activeTypes.has(event.type));
    return filtered.slice(0, MAX_GRAPH_EVENTS);
  }, [events, activeTypes]);

  const graphData = useMemo(() => {
    const next = buildGraph(filteredEvents);
    const fingerprint = graphDataFingerprint(next);
    if (fingerprint === fingerprintRef.current) {
      return graphDataRef.current;
    }
    fingerprintRef.current = fingerprint;
    graphDataRef.current = next;
    return next;
  }, [filteredEvents]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SpaceScene(container);
    sceneRef.current = scene;
    setAutoRotating(scene.getAutoRotate());
    const unsubscribeAutoRotate = scene.onAutoRotateChange(setAutoRotating);

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

    const layoutTargets = [container.parentElement, container.parentElement?.parentElement];
    for (const target of layoutTargets) {
      if (target) observer.observe(target);
    }

    window.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);

    return () => {
      unsubscribeAutoRotate();
      observer.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    scene.updateGraph(graphData);

    for (const event of filteredEvents) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);

      const actorLogin = event.actor?.login;
      const repoName = event.repo?.name;
      if (!actorLogin || !repoName) continue;

      scene.enqueueComet(
        `actor:${actorLogin}`,
        groupedEventNodeId(event.type, repoName),
        eventColor(event.type),
        event.type === 'PushEvent' ? event.commitMessage ?? undefined : undefined,
      );
    }

    if (seenEventIds.current.size > MAX_GRAPH_EVENTS * 2) {
      seenEventIds.current = new Set(filteredEvents.map((event) => event.id));
    }
  }, [graphData, filteredEvents]);

  useEffect(() => {
    onEventCountChange?.(filteredEvents.length);
  }, [filteredEvents, onEventCountChange]);

  return (
    <div ref={containerRef} className="space-visualization">
      {!autoRotating && (
        <button
          type="button"
          className="space-auto-rotate-btn"
          onClick={() => sceneRef.current?.setAutoRotate(true)}
          aria-label="Resume auto-rotation"
        >
          ↻ Auto-rotate
        </button>
      )}
      {graphData.nodes.length === 0 && (
        <div className="space-placeholder">
          <div className="space-placeholder__ring" />
          <p>Scanning the cosmos for GitHub activity...</p>
          <p className="hint">
            Developers appear as stars, repositories as crystal worlds — activity streams in as comets
            and merges into each repo&apos;s event satellite.
          </p>
        </div>
      )}
    </div>
  );
}
