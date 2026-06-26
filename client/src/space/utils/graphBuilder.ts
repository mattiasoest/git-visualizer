import type { EventView } from '../../types/event';
import { eventColor } from '../../types/event';

export interface GraphNode {
  id: string;
  label: string;
  kind: 'repo' | 'event';
  eventCount: number;
  eventType?: string;
  color?: string;
  parentRepoId?: string;
  ownerOrg?: string;
  actorLogin?: string;
  commitMessage?: string;
  createdAt?: string;
}

export interface GraphLink {
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  key: string;
  kind: 'tether';
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function eventNodeId(eventId: string): string {
  return `event:${eventId}`;
}

const BURST_GROUP_MIN = 3;
const BURST_SIZE_SCALE = 1.4;

export interface EventBurstGrouping {
  sizeScale: number;
  suppressed: boolean;
  upgraded: boolean;
}

function burstGroupKey(node: GraphNode): string | null {
  if (!node.parentRepoId || !node.actorLogin || !node.eventType) return null;
  return `${node.parentRepoId}:${node.actorLogin}:${node.eventType}`;
}

function normalGrouping(): EventBurstGrouping {
  return { sizeScale: 1, suppressed: false, upgraded: false };
}

/** When a repo has 3+ events of the same type from the same user, every 3 collapse into one 2× particle; leftover events stay normal size. */
export function computeEventBurstGrouping(
  eventNodes: GraphNode[],
  spawnedNodeIds: ReadonlySet<string> = new Set(),
): Map<string, EventBurstGrouping> {
  const result = new Map<string, EventBurstGrouping>();
  const groups = new Map<string, GraphNode[]>();

  for (const node of eventNodes) {
    const key = burstGroupKey(node);
    if (!key) {
      result.set(node.id, normalGrouping());
      continue;
    }
    const members = groups.get(key) ?? [];
    members.push(node);
    groups.set(key, members);
  }

  for (const members of groups.values()) {
    members.sort(
      (earlierEvent, laterEvent) =>
        new Date(earlierEvent.createdAt ?? 0).getTime() -
        new Date(laterEvent.createdAt ?? 0).getTime(),
    );

    const count = members.length;

    for (let idx = 0; idx < count; idx++) {
      const node = members[idx]!;
      const blockStart = Math.floor(idx / BURST_GROUP_MIN) * BURST_GROUP_MIN;
      const blockEnd = blockStart + BURST_GROUP_MIN - 1;
      const blockFull = count > blockEnd;

      const thirdInBlock = blockFull ? members[blockEnd]! : null;
      const blockMerged =
        blockFull &&
        thirdInBlock !== null &&
        spawnedNodeIds.has(thirdInBlock.id);

      if (idx < blockStart || idx > blockEnd || !blockMerged) {
        result.set(node.id, normalGrouping());
        continue;
      }

      const tripletIdx = idx - blockStart;
      const isRepresentative = tripletIdx === 0;
      result.set(node.id, {
        sizeScale: isRepresentative ? BURST_SIZE_SCALE : 1,
        suppressed: !isRepresentative,
        upgraded: isRepresentative,
      });
    }
  }

  return result;
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
      event.type === 'PushEvent' && event.commitMessage
        ? event.commitMessage
        : event.summary;

    const ownerOrg = repoName.includes('/')
      ? repoName.split('/')[0]!
      : repoName;
    const repoNode = nodes.get(repoId) ?? {
      id: repoId,
      label: repoName.split('/').pop() ?? repoName,
      kind: 'repo' as const,
      ownerOrg,
      eventCount: 0,
    };
    repoNode.eventCount += 1;
    nodes.set(repoId, repoNode);

    nodes.set(nodeId, {
      id: nodeId,
      label: displayLabel,
      kind: 'event' as const,
      eventType: event.type,
      color,
      parentRepoId: repoId,
      actorLogin,
      createdAt: event.createdAt,
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
      kind: 'tether' as const,
    });
  }

  const linkedRepoIds = new Set<string>();
  const linkedEventIds = new Set<string>();
  for (const link of links.values()) {
    linkedEventIds.add(link.sourceId);
    linkedRepoIds.add(link.targetId);
  }

  const filteredNodes = Array.from(nodes.values()).filter((node) => {
    if (node.kind === 'repo') return linkedRepoIds.has(node.id);
    if (node.kind === 'event') return linkedEventIds.has(node.id);
    return true;
  });

  return { nodes: filteredNodes, links: Array.from(links.values()) };
}

export function graphDataFingerprint(data: GraphData): string {
  const nodePart = data.nodes
    .map((node) =>
      node.kind === 'event'
        ? `${node.id}:${node.eventType}:${node.createdAt ?? ''}`
        : `${node.id}:${node.eventCount}`,
    )
    .sort()
    .join('|');
  const linkPart = data.links
    .map((link) => `${link.key}:${link.weight}`)
    .sort()
    .join('|');
  return `${nodePart}::${linkPart}`;
}
