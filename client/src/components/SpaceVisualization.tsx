import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import {
  buildGraph,
  graphDataFingerprint,
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
  const [labelsVisible, setLabelsVisible] = useState(true);
  const activeTypesRef = useRef(activeTypes);
  activeTypesRef.current = activeTypes;

  const filteredEvents = useMemo(() => {
    return events.filter((event) => activeTypes.has(event.type));
  }, [events, activeTypes]);

  const graphData = useMemo(() => {
    const next = buildGraph(events);
    const fingerprint = graphDataFingerprint(next);
    if (fingerprint === fingerprintRef.current) {
      return graphDataRef.current;
    }
    fingerprintRef.current = fingerprint;
    graphDataRef.current = next;
    return next;
  }, [events]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SpaceScene(container);
    sceneRef.current = scene;
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

    const layoutTargets = [container.parentElement, container.parentElement?.parentElement];
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
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    scene.updateGraph(graphData);

    const activeTypes = activeTypesRef.current;
    for (const event of events) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);

      const actorLogin = event.actor?.login;
      const repoName = event.repo?.name;
      if (!actorLogin || !repoName) continue;

      if (!activeTypes.has(event.type)) {
        scene.instantRevealEvent(event.id);
        continue;
      }

      const eventLabel =
        event.type === 'PushEvent' && event.commitMessage
          ? event.commitMessage
          : event.summary;

      scene.enqueueEventFlight({
        eventId: event.id,
        repoId: `repo:${repoName}`,
        actorLogin,
        eventColor: eventColor(event.type),
        eventLabel,
      });
    }

    scene.syncEventTypeFilterVisibility();

    if (seenEventIds.current.size > events.length * 2) {
      seenEventIds.current = new Set(events.map((event) => event.id));
    }
  }, [graphData, events]);

  useEffect(() => {
    sceneRef.current?.setActiveEventTypes(activeTypes);
  }, [activeTypes]);

  useEffect(() => {
    onEventCountChange?.(filteredEvents.length);
  }, [filteredEvents, onEventCountChange]);

  return (
    <div ref={containerRef} className="space-visualization">
      <button
        type="button"
        className="space-labels-btn"
        aria-pressed={labelsVisible}
        aria-label={labelsVisible ? 'Hide text labels' : 'Show text labels'}
        onClick={() => sceneRef.current?.setLabelsVisible(!labelsVisible)}
      >
        {labelsVisible ? 'Labels ON' : 'Labels OFF'}
      </button>
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
            Repositories appear as crystal worlds — green user particles launch from each world,
            morph into activity, and settle as orbiting satellites with developer names.
          </p>
        </div>
      )}
    </div>
  );
}
