import type { EventView } from '../../types/event';
import { eventColor } from '../../types/event';

export const MAX_GRAPH_EVENTS = 80;

export interface GraphNode {
  id: string;
  label: string;
  kind: 'actor' | 'repo';
  avatarUrl?: string;
  eventCount: number;
}

export interface GraphLink {
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  key: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function buildGraph(events: EventView[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const linkMap = new Map<string, GraphLink>();

  for (const event of events) {
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
        sourceId: actorId,
        targetId: repoId,
        weight: 1,
        color: eventColor(event.type),
        key: linkKey,
      };
      linkMap.set(linkKey, link);
      links.push(link);
    }
  }

  return { nodes: Array.from(nodes.values()), links };
}
