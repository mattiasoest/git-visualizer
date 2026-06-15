import * as THREE from 'three';
import { GALAXY_SPACING } from './constants';

const scratch = new THREE.Vector3();

export function segmentWorldOffset(index: number, totalSegments: number): THREE.Vector3 {
  const totalWidth = (totalSegments - 1) * GALAXY_SPACING;
  return scratch.set(index * GALAXY_SPACING - totalWidth / 2, 0, 0).clone();
}

export function archiveSegmentIndex(archiveIndex: number): number {
  return archiveIndex;
}

export function activeSegmentIndex(archiveCount: number): number {
  return archiveCount;
}

export function totalSegmentCount(archiveCount: number): number {
  return archiveCount + 1;
}
