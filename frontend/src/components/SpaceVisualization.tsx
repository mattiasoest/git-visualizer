import { useEffect, useMemo, useRef } from 'react';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import { buildGraph, MAX_GRAPH_EVENTS } from './space/graphBuilder';
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

  const filteredEvents = useMemo(() => {
    const filtered = events.filter((event) => activeTypes.has(event.type));
    return filtered.slice(0, MAX_GRAPH_EVENTS);
  }, [events, activeTypes]);

  const graphData = useMemo(() => buildGraph(filteredEvents), [filteredEvents]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SpaceScene(container);
    sceneRef.current = scene;

    const observer = new ResizeObserver(([entry]) => {
      scene.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateGraph(graphData);
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
