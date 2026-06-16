import * as THREE from 'three';
import { ACTIVE_CLUSTER_GAP } from './constants';

const scratch = new THREE.Vector3();

/**
 * Fixed X slot for an archived galaxy — each forms where the active cluster was
 * before merge, so positions never shift when new ones are added.
 */
export function archiveWorldOffset(archiveIndex: number): THREE.Vector3 {
  return scratch.set(archiveIndex * ACTIVE_CLUSTER_GAP, 0, 0).clone();
}

/** X slot for the active cluster; one full gap beyond the newest galaxy. */
export function activeClusterWorldOffset(archiveCount: number): THREE.Vector3 {
  return scratch.set(archiveCount * ACTIVE_CLUSTER_GAP, 0, 0).clone();
}

export function archiveSegmentIndex(archiveIndex: number): number {
  return archiveIndex;
}

export function activeSegmentIndex(archiveCount: number): number {
  return archiveCount;
}
