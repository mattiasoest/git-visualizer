import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import { useImageCache } from '../hooks/useImageCache';

const MAX_GRAPH_EVENTS = 80;
const PARTICLE_DURATION_MS = 2500;

interface GraphNode extends NodeObject {
  id: string;
  label: string;
  kind: 'actor' | 'repo';
  avatarUrl?: string;
  eventCount: number;
}

interface GraphLink extends LinkObject {
  source: string;
  target: string;
  weight: number;
  color: string;
  index: number;
}

interface ActivityGraphProps {
  events: EventView[];
  activeTypes: Set<string>;
}

export function ActivityGraph({ events, activeTypes }: ActivityGraphProps) {
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const seenEventIds = useRef<Set<string>>(new Set());
  const particleTimersRef = useRef<number[]>([]);
  const [activeLinkIndices, setActiveLinkIndices] = useState<Set<number>>(() => new Set());

  const filteredEvents = useMemo(() => {
    const filtered = events.filter((event) => activeTypes.has(event.type));
    return filtered.slice(0, MAX_GRAPH_EVENTS);
  }, [events, activeTypes]);

  const avatarUrls = useMemo(
    () => filteredEvents.map((event) => event.actor?.avatarUrl).filter(Boolean) as string[],
    [filteredEvents],
  );
  const imageCache = useImageCache(avatarUrls);

  const graphData = useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    const links: GraphLink[] = [];
    const linkMap = new Map<string, GraphLink>();

    for (const event of filteredEvents) {
      const actorLogin = event.actor?.login;
      const repoName = event.repo?.name;
      if (!actorLogin || !repoName) continue;

      const actorId = `actor:${actorLogin}`;
      const repoId = `repo:${repoName}`;

      const actorNode = nodes.get(actorId) ?? {
        id: actorId,
        label: actorLogin,
        kind: 'actor' as const,
        avatarUrl: event.actor?.avatarUrl,
        eventCount: 0,
      };
      actorNode.eventCount += 1;
      nodes.set(actorId, actorNode);

      const repoNode = nodes.get(repoId) ?? {
        id: repoId,
        label: repoName.split('/').pop() ?? repoName,
        kind: 'repo' as const,
        eventCount: 0,
      };
      repoNode.eventCount += 1;
      nodes.set(repoId, repoNode);

      const linkKey = `${actorId}->${repoId}`;
      const existingLink = linkMap.get(linkKey);
      if (existingLink) {
        existingLink.weight += 1;
      } else {
        const link: GraphLink = {
          source: actorId,
          target: repoId,
          weight: 1,
          color: eventColor(event.type),
          index: links.length,
        };
        linkMap.set(linkKey, link);
        links.push(link);
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      links,
    };
  }, [filteredEvents]);

  useEffect(() => {
    const newIndices: number[] = [];
    for (const event of filteredEvents) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);

      const actorLogin = event.actor?.login;
      const repoName = event.repo?.name;
      if (!actorLogin || !repoName) continue;

      const linkIndex = graphData.links.findIndex(
        (link) => link.source === `actor:${actorLogin}` && link.target === `repo:${repoName}`,
      );
      if (linkIndex < 0) continue;

      const timer = window.setTimeout(() => {
        setActiveLinkIndices((current) => {
          if (!current.has(linkIndex)) return current;
          const next = new Set(current);
          next.delete(linkIndex);
          return next;
        });
      }, PARTICLE_DURATION_MS);
      particleTimersRef.current.push(timer);
      newIndices.push(linkIndex);
    }

    if (newIndices.length > 0) {
      setActiveLinkIndices((current) => {
        const next = new Set(current);
        for (const index of newIndices) {
          next.add(index);
        }
        return next;
      });
    }

    if (seenEventIds.current.size > MAX_GRAPH_EVENTS * 2) {
      const keep = new Set(filteredEvents.map((event) => event.id));
      seenEventIds.current = keep;
    }
  }, [filteredEvents, graphData.links]);

  useEffect(() => {
    const timers = particleTimersRef.current;
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const linkDirectionalParticles = useCallback(
    (link: GraphLink) => (activeLinkIndices.has(link.index) ? 3 : 0),
    [activeLinkIndices],
  );

  const linkWidth = useCallback((link: GraphLink) => Math.min(1 + link.weight * 0.5, 6), []);

  const linkColor = useCallback((link: GraphLink) => link.color, []);

  const linkDirectionalParticleColor = useCallback((link: GraphLink) => link.color, []);

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = node.kind === 'actor' ? 10 : 8 + Math.min(node.eventCount, 10);
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (node.kind === 'actor' && node.avatarUrl) {
        const image = imageCache.current.get(node.avatarUrl);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.fillStyle = '#21262d';
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.clip();
        if (image?.complete) {
          ctx.drawImage(image, x - size, y - size, size * 2, size * 2);
        }
        ctx.restore();
        ctx.strokeStyle = '#58a6ff';
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.fillStyle = node.kind === 'repo' ? '#238636' : '#1f6feb';
        ctx.fill();
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      const fontSize = 12 / globalScale;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#c9d1d9';
      ctx.fillText(node.label, x, y + size + 2);
    },
    [imageCache],
  );

  return (
    <div ref={containerRef} className="activity-graph">
      {graphData.nodes.length === 0 ? (
        <div className="graph-placeholder">
          <p>Waiting for GitHub activity...</p>
          <p className="hint">Events appear as nodes and animated links between actors and repositories.</p>
        </div>
      ) : (
        <ForceGraph2D
          ref={graphRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          backgroundColor="#0d1117"
          nodeRelSize={6}
          linkDirectionalParticles={linkDirectionalParticles}
          linkDirectionalParticleWidth={3}
          linkDirectionalParticleColor={linkDirectionalParticleColor}
          linkWidth={linkWidth}
          linkColor={linkColor}
          cooldownTicks={40}
          d3AlphaDecay={0.05}
          nodeCanvasObject={nodeCanvasObject}
        />
      )}
    </div>
  );
}
