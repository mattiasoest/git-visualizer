import type { EventView } from "../../types/event";
import { eventColor } from "../../types/event";

export const MAX_GRAPH_EVENTS = 1000;

export interface GraphNode {
  id: string;
  label: string;
  kind: "actor" | "repo" | "event";
  avatarUrl?: string;
  eventCount: number;
  eventType?: string;
  color?: string;
  parentRepoId?: string;
  commitMessage?: string;
}

export interface GraphLink {
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  key: string;
  kind: "activity" | "tether";
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function eventNodeId(eventId: string): string {
  return `event:${eventId}`;
}

export function buildGraph(events: EventView[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  for (const event of events) {
    const actorLogin = event.actor?.login;
    const repoName = event.repo?.name;
    if (!actorLogin || !repoName) continue;

    const actorId = `actor:${actorLogin}`;
    const repoId = `repo:${repoName}`;
    const nodeId = eventNodeId(event.id);
    const color = eventColor(event.type);
    const displayLabel =
      event.type === "PushEvent" && event.commitMessage
        ? event.commitMessage
        : event.summary;

    const actorNode = nodes.get(actorId) ?? {
      id: actorId,
      label: actorLogin,
      kind: "actor" as const,
      avatarUrl: event.actor?.avatarUrl,
      eventCount: 0,
    };
    actorNode.eventCount += 1;
    nodes.set(actorId, actorNode);

    const repoNode = nodes.get(repoId) ?? {
      id: repoId,
      label: repoName.split("/").pop() ?? repoName,
      kind: "repo" as const,
      eventCount: 0,
    };
    repoNode.eventCount += 1;
    nodes.set(repoId, repoNode);

    nodes.set(nodeId, {
      id: nodeId,
      label: displayLabel,
      kind: "event",
      eventType: event.type,
      color,
      parentRepoId: repoId,
      eventCount: 1,
      commitMessage: event.commitMessage ?? undefined,
    });

    links.push({
      sourceId: actorId,
      targetId: nodeId,
      weight: 1,
      color,
      key: `${actorId}->${nodeId}`,
      kind: "activity",
    });

    links.push({
      sourceId: nodeId,
      targetId: repoId,
      weight: 1,
      color,
      key: `${nodeId}->${repoId}`,
      kind: "tether",
    });
  }

  return { nodes: Array.from(nodes.values()), links };
}

export function graphDataFingerprint(data: GraphData): string {
  const nodePart = data.nodes
    .map((n) => (n.kind === "event" ? n.id : `${n.id}:${n.eventCount}`))
    .sort()
    .join("|");
  const linkPart = data.links
    .map((l) => l.key)
    .sort()
    .join("|");
  return `${nodePart}::${linkPart}`;
}
