import type { EventView } from "../../types/event";
import { eventColor } from "../../types/event";

export interface GraphNode {
  id: string;
  label: string;
  kind: "actor" | "repo" | "event";
  avatarUrl?: string;
  eventCount: number;
  eventType?: string;
  color?: string;
  parentRepoId?: string;
  ownerOrg?: string;
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

/** One activity node per event type + repository (e.g. all pushes to same repo share one satellite). */
export function groupedEventNodeId(eventType: string, repoName: string): string {
  return `event:${eventType}:${repoName}`;
}

export function buildGraph(events: EventView[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();

  for (const event of events) {
    const actorLogin = event.actor?.login;
    const repoName = event.repo?.name;
    if (!actorLogin || !repoName) continue;

    const actorId = `actor:${actorLogin}`;
    const repoId = `repo:${repoName}`;
    const nodeId = groupedEventNodeId(event.type, repoName);
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

    const eventNode = nodes.get(nodeId) ?? {
      id: nodeId,
      label: displayLabel,
      kind: "event" as const,
      eventType: event.type,
      color,
      parentRepoId: repoId,
      eventCount: 0,
      commitMessage: event.commitMessage ?? undefined,
    };
    eventNode.eventCount += 1;
    eventNode.label = displayLabel;
    eventNode.commitMessage = event.commitMessage ?? undefined;
    nodes.set(nodeId, eventNode);

    const activityKey = `${actorId}->${nodeId}`;
    const activityLink = links.get(activityKey) ?? {
      sourceId: actorId,
      targetId: nodeId,
      weight: 0,
      color,
      key: activityKey,
      kind: "activity" as const,
    };
    activityLink.weight += 1;
    links.set(activityKey, activityLink);

    const tetherKey = `${nodeId}->${repoId}`;
    const tetherLink = links.get(tetherKey) ?? {
      sourceId: nodeId,
      targetId: repoId,
      weight: 0,
      color,
      key: tetherKey,
      kind: "tether" as const,
    };
    tetherLink.weight += 1;
    links.set(tetherKey, tetherLink);
  }

  const linkedActorIds = new Set<string>();
  const linkedRepoIds = new Set<string>();
  const linkedEventIds = new Set<string>();
  for (const link of links.values()) {
    if (link.kind === "activity") {
      linkedActorIds.add(link.sourceId);
      linkedEventIds.add(link.targetId);
    } else {
      linkedEventIds.add(link.sourceId);
      linkedRepoIds.add(link.targetId);
    }
  }

  const filteredNodes = Array.from(nodes.values()).filter((node) => {
    if (node.kind === "actor") return linkedActorIds.has(node.id);
    if (node.kind === "repo") return linkedRepoIds.has(node.id);
    if (node.kind === "event") return linkedEventIds.has(node.id);
    return true;
  });

  return { nodes: filteredNodes, links: Array.from(links.values()) };
}

export function graphDataFingerprint(data: GraphData): string {
  const nodePart = data.nodes
    .map((n) =>
      n.kind === "event" ? `${n.id}:${n.eventCount}:${n.label}` : `${n.id}:${n.eventCount}`,
    )
    .sort()
    .join("|");
  const linkPart = data.links
    .map((l) => `${l.key}:${l.weight}`)
    .sort()
    .join("|");
  return `${nodePart}::${linkPart}`;
}
