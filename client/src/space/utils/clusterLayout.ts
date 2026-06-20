import * as THREE from 'three';
import type { GraphNode } from './graphBuilder';

export const ORG_SPLIT_THRESHOLD = 4;
export const META_ORBIT_BASE = 48;
export const SUB_ORBIT_RADIUS = 12;
export const SUB_ORBIT_MIN = 3;
const REPO_ORBIT_SPREAD = 0.6;
const EVENT_ORBIT_RADIUS = 6.5;
export const EVENT_NODE_BASE_RADIUS = 0.75;
export const EVENT_PARTICLE_DIAMETER = EVENT_NODE_BASE_RADIUS * 2.2;
const ORBIT_ANGULAR_SPEED = 0.25;

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchOrbit = new THREE.Vector3();

export function hashToUnitVector(id: string): THREE.Vector3 {
  let hash = 0;
  for (let charIndex = 0; charIndex < id.length; charIndex++) {
    hash = (hash << 5) - hash + id.charCodeAt(charIndex);
    hash |= 0;
  }
  const azimuthUnit = ((hash & 0xffff) / 0xffff) * 2 - 1;
  const elevationUnit = (((hash >> 16) & 0xffff) / 0xffff) * 2 - 1;
  const theta = azimuthUnit * Math.PI * 2;
  const phi = Math.acos(Math.max(-1, Math.min(1, elevationUnit)));
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta) * 0.55,
    Math.cos(phi),
  );
}

export function eventOrbitAngle(eventId: string, time = 0, phaseOffset = 0): number {
  const hash = hashToUnitVector(eventId);
  const baseAngle = (hash.x + 1) * Math.PI;
  return baseAngle + time * ORBIT_ANGULAR_SPEED + hash.z * 0.35 + phaseOffset;
}

export function eventOrbitOffset(eventId: string, time = 0, phaseOffset = 0): THREE.Vector3 {
  const hash = hashToUnitVector(eventId);
  const radius = EVENT_ORBIT_RADIUS + (hash.y + 1) * 2;
  const angle = eventOrbitAngle(eventId, time, phaseOffset);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    (hash.z * 0.5 + 0.5) * radius * 0.4 - radius * 0.15,
    Math.sin(angle) * radius * 0.85,
  );
}

export function resolveEventOrbitPhaseOffset(
  eventId: string,
  time: number,
  siblings: { id: string; phaseOffset: number }[],
): number {
  const minDist = EVENT_PARTICLE_DIAMETER;
  const radius = EVENT_ORBIT_RADIUS + (hashToUnitVector(eventId).y + 1) * 2;
  const angleStep = minDist / radius;
  const maxPhase = Math.PI * 2;

  let phaseOffset = 0;
  while (phaseOffset < maxPhase) {
    scratchOrbit.copy(eventOrbitOffset(eventId, time, phaseOffset));
    let tooClose = false;

    for (const sibling of siblings) {
      if (sibling.id === eventId) continue;
      const dist = scratchOrbit.distanceTo(
        eventOrbitOffset(sibling.id, time, sibling.phaseOffset),
      );
      if (dist < minDist) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) return phaseOffset;
    phaseOffset += angleStep;
  }

  return phaseOffset;
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
    .sort(([orgA], [orgB]) => orgA.localeCompare(orgB))
    .map(([ownerOrg, repoIds]) => ({
      ownerOrg,
      repoIds: repoIds.sort(),
      hubDirection: hashToUnitVector(`org:${ownerOrg}`).normalize(),
    }));
}

export function computeHierarchicalPositions(
  nodes: GraphNode[],
  _links: unknown[],
): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const repos = nodes.filter((node) => node.kind === 'repo');

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

  return positions;
}
