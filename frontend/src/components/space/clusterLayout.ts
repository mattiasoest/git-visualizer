import * as THREE from 'three';
import type { GraphLink, GraphNode } from './graphBuilder';

export const ORG_SPLIT_THRESHOLD = 4;
export const META_ORBIT_BASE = 48;
export const SUB_ORBIT_RADIUS = 12;
export const SUB_ORBIT_MIN = 3;
const REPO_ORBIT_SPREAD = 0.6;
const ACTOR_CLUSTER_RADIUS = 6;
const EVENT_ORBIT_RADIUS = 5.5;

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchD = new THREE.Vector3();
const scratchE = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchTangent1 = new THREE.Vector3();
const scratchTangent2 = new THREE.Vector3();

export function hashToUnitVector(id: string): THREE.Vector3 {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const u = ((hash & 0xffff) / 0xffff) * 2 - 1;
  const v = (((hash >> 16) & 0xffff) / 0xffff) * 2 - 1;
  const theta = u * Math.PI * 2;
  const phi = Math.acos(Math.max(-1, Math.min(1, v)));
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta) * 0.55,
    Math.cos(phi),
  );
}

export function eventOrbitOffset(eventId: string, time = 0): THREE.Vector3 {
  const hash = hashToUnitVector(eventId);
  const baseAngle = (hash.x + 1) * Math.PI;
  const radius = EVENT_ORBIT_RADIUS + (hash.y + 1) * 2;
  const wobble = time * 0.25 + hash.z * 0.35;
  const angle = baseAngle + wobble;
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    (hash.z * 0.5 + 0.5) * radius * 0.4 - radius * 0.15,
    Math.sin(angle) * radius * 0.85,
  );
}

export interface OrgCluster {
  ownerOrg: string;
  repoIds: string[];
  hubDirection: THREE.Vector3;
}

export function buildOrgClusters(repos: GraphNode[]): OrgCluster[] {
  const byOrg = new Map<string, string[]>();
  for (const repo of repos) {
    const org =
      repo.ownerOrg ?? repo.id.replace(/^repo:/, '').split('/')[0] ?? repo.id;
    const list = byOrg.get(org) ?? [];
    list.push(repo.id);
    byOrg.set(org, list);
  }

  return Array.from(byOrg.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ownerOrg, repoIds]) => ({
      ownerOrg,
      repoIds: repoIds.sort(),
      hubDirection: hashToUnitVector(`org:${ownerOrg}`).normalize(),
    }));
}

export function computeHierarchicalPositions(
  nodes: GraphNode[],
  links: GraphLink[],
): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const repos = nodes.filter((n) => n.kind === 'repo');
  const actors = nodes.filter((n) => n.kind === 'actor');

  const actorToRepos = new Map<string, { repoId: string; weight: number }[]>();
  for (const link of links) {
    if (link.kind !== 'activity') continue;
    const eventNode = nodeById.get(link.targetId);
    if (!eventNode?.parentRepoId) continue;
    const list = actorToRepos.get(link.sourceId) ?? [];
    list.push({ repoId: eventNode.parentRepoId, weight: link.weight });
    actorToRepos.set(link.sourceId, list);
  }

  const clusters = buildOrgClusters(repos);
  for (const cluster of clusters) {
    const hubPos = scratchA.copy(cluster.hubDirection).multiplyScalar(META_ORBIT_BASE);
    const useSubSphere = cluster.repoIds.length >= ORG_SPLIT_THRESHOLD;

    for (const repoId of cluster.repoIds) {
      const repo = nodeById.get(repoId);
      if (!repo) continue;
      const activityBump = Math.min(repo.eventCount, 8) * REPO_ORBIT_SPREAD;
      const direction = hashToUnitVector(repoId).normalize();

      if (useSubSphere) {
        scratchB.copy(hubPos).add(direction.multiplyScalar(SUB_ORBIT_RADIUS + activityBump));
      } else {
        scratchB.copy(hubPos).add(direction.multiplyScalar(SUB_ORBIT_MIN + activityBump * 0.5));
      }
      positions.set(repoId, scratchB.clone());
    }
  }

  for (const node of nodes) {
    if (node.kind !== 'event' || !node.parentRepoId) continue;
    const repoPos = positions.get(node.parentRepoId);
    if (!repoPos) continue;
    positions.set(node.id, repoPos.clone().add(eventOrbitOffset(node.id)));
  }

  for (const actor of actors) {
    const connections = actorToRepos.get(actor.id);
    if (!connections || connections.length === 0) continue;

    scratchA.set(0, 0, 0);
    let totalWeight = 0;
    for (const { repoId, weight } of connections) {
      const repoPos = positions.get(repoId);
      if (!repoPos) continue;
      scratchA.add(scratchB.copy(repoPos).multiplyScalar(weight));
      totalWeight += weight;
    }
    if (totalWeight === 0) continue;
    scratchA.divideScalar(totalWeight);

    const hash = hashToUnitVector(actor.id);
    const angle = (hash.x + 1) * Math.PI;
    const dist = ACTOR_CLUSTER_RADIUS * (0.55 + (hash.y + 1) * 0.22);

    scratchNormal.copy(scratchA).normalize();
    scratchUp.set(0, 1, 0);
    if (Math.abs(scratchNormal.y) >= 0.9) {
      scratchUp.set(1, 0, 0);
    }
    scratchTangent1.crossVectors(scratchNormal, scratchUp).normalize();
    scratchTangent2.crossVectors(scratchNormal, scratchTangent1);

    scratchC.copy(scratchTangent1).multiplyScalar(Math.cos(angle) * dist);
    scratchD.copy(scratchTangent2).multiplyScalar(Math.sin(angle) * dist);
    scratchE.copy(scratchNormal).multiplyScalar(-dist * 0.25);

    scratchB.copy(scratchA).add(scratchC).add(scratchD).add(scratchE);
    positions.set(actor.id, scratchB.clone());
  }

  return positions;
}
