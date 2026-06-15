import * as THREE from 'three';
import { GALAXY_SPACING } from './constants';

const scratch = new THREE.Vector3();

/** Fixed X slot for an archived galaxy — positions never shift when new ones are added. */
export function archiveWorldOffset(archiveIndex: number): THREE.Vector3 {
  return scratch.set(archiveIndex * GALAXY_SPACING, 0, 0).clone();
}

/** X slot for the active cluster; moves one step right each time a galaxy is archived. */
export function activeClusterWorldOffset(archiveCount: number): THREE.Vector3 {
  return scratch.set(archiveCount * GALAXY_SPACING, 0, 0).clone();
}

export function archiveSegmentIndex(archiveIndex: number): number {
  return archiveIndex;
}

export function activeSegmentIndex(archiveCount: number): number {
  return archiveCount;
}
