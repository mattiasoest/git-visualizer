import type { EventView } from "../../types/event";
import { eventColor } from "../../types/event";

export interface GraphNode {
  id: string;
  label: string;
  kind: "repo" | "event";
  eventCount: number;
  eventType?: string;
  color?: string;
  parentRepoId?: string;
  ownerOrg?: string;
  actorLogin?: string;
  commitMessage?: string;
}

export interface GraphLink {
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  key: string;
  kind: "tether";
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
  const links = new Map<string, GraphLink>();

  for (const event of events) {
    const actorLogin = event.actor?.login;
    const repoName = event.repo?.name;
    if (!actorLogin || !repoName) continue;

    const repoId = `repo:${repoName}`;
    const nodeId = eventNodeId(event.id);
    const color = eventColor(event.type);
    const displayLabel =
      event.type === "PushEvent" && event.commitMessage
        ? event.commitMessage
        : event.summary;

    const ownerOrg = repoName.includes("/") ? repoName.split("/")[0]! : repoName;
    const repoNode = nodes.get(repoId) ?? {
      id: repoId,
      label: repoName.split("/").pop() ?? repoName,
      kind: "repo" as const,
      ownerOrg,
      eventCount: 0,
    };
    repoNode.eventCount += 1;
    nodes.set(repoId, repoNode);

    nodes.set(nodeId, {
      id: nodeId,
      label: displayLabel,
      kind: "event" as const,
      eventType: event.type,
      color,
      parentRepoId: repoId,
      actorLogin,
      eventCount: 1,
      commitMessage: event.commitMessage ?? undefined,
    });

    const tetherKey = `${nodeId}->${repoId}`;
    links.set(tetherKey, {
      sourceId: nodeId,
      targetId: repoId,
      weight: 1,
      color,
      key: tetherKey,
      kind: "tether" as const,
    });
  }

  const linkedRepoIds = new Set<string>();
  const linkedEventIds = new Set<string>();
  for (const link of links.values()) {
    linkedEventIds.add(link.sourceId);
    linkedRepoIds.add(link.targetId);
  }

  const filteredNodes = Array.from(nodes.values()).filter((node) => {
    if (node.kind === "repo") return linkedRepoIds.has(node.id);
    if (node.kind === "event") return linkedEventIds.has(node.id);
    return true;
  });

  return { nodes: filteredNodes, links: Array.from(links.values()) };
}

export function graphDataFingerprint(data: GraphData): string {
  const nodePart = data.nodes
    .map((n) =>
      n.kind === "event"
        ? `${n.id}:${n.actorLogin}:${n.label}`
        : `${n.id}:${n.eventCount}`,
    )
    .sort()
    .join("|");
  const linkPart = data.links
    .map((l) => `${l.key}:${l.weight}`)
    .sort()
    .join("|");
  return `${nodePart}::${linkPart}`;
}
