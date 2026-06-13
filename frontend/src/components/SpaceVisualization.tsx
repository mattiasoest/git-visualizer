import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import {
  buildGraph,
  graphDataFingerprint,
  MAX_GRAPH_EVENTS,
  type GraphData,
} from './space/graphBuilder';
import { SpaceScene } from './space/SpaceScene';

interface SpaceVisualizationProps {
  events: EventView[];
  activeTypes: Set<string>;
}

export function SpaceVisualization({ events, activeTypes }: SpaceVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const seenEventIds = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const graphDataRef = useRef<GraphData>({ nodes: [], links: [] });
  const fingerprintRef = useRef('');
  const pendingGraphRef = useRef<GraphData | null>(null);
  const rafRef = useRef<number | null>(null);
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

    const observer = new ResizeObserver(([entry]) => {
      scene.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);

    return () => {
      unsubscribeAutoRotate();
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    pendingGraphRef.current = graphData;
    if (rafRef.current !== null) return;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const data = pendingGraphRef.current;
      if (data) {
        sceneRef.current?.updateGraph(data);
      }
    });
  }, [graphData]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Seed the initial snapshot without animating — avoids dozens of comets on load
    if (!seededRef.current) {
      if (filteredEvents.length === 0) return;
      for (const event of filteredEvents) {
        seenEventIds.current.add(event.id);
      }
      seededRef.current = true;
      return;
    }

    for (const event of filteredEvents) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);

      const actorLogin = event.actor?.login;
      const repoName = event.repo?.name;
      if (!actorLogin || !repoName) continue;

      scene.spawnComet(
        `actor:${actorLogin}`,
        `repo:${repoName}`,
        eventColor(event.type),
      );
    }

    if (seenEventIds.current.size > MAX_GRAPH_EVENTS * 2) {
      seenEventIds.current = new Set(filteredEvents.map((event) => event.id));
    }
  }, [filteredEvents]);

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
            Developers appear as stars, repositories as crystal worlds — events streak across the void as comets.
          </p>
        </div>
      )}
    </div>
  );
}
