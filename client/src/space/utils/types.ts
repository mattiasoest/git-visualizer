import type * as THREE from 'three';
import type { GraphNode } from './graphBuilder';

export interface EventFlightPayload {
  eventId: string;
  repoId: string;
  eventColor: string;
}

export interface QueuedFlight extends EventFlightPayload {}

export interface NodeState {
  node: GraphNode;
  anchor: THREE.Group;
  visual: THREE.Group;
  label: THREE.Sprite;
  position: THREE.Vector3;
  pulseUntil: number;
  repoMaterials?: {
    atmosphere: THREE.MeshBasicMaterial;
    innerGlow: THREE.MeshBasicMaterial;
    outerShell: THREE.MeshBasicMaterial;
    outerWire: THREE.MeshBasicMaterial;
    innerCore: THREE.MeshBasicMaterial;
  };
  repoRingMaterials?: THREE.MeshBasicMaterial[];
  repoInnerCore?: THREE.Mesh;
  repoOrbitRings?: THREE.Mesh[];
  repoRingTier?: number;
  spawnStartTime: number;
  baseRadius: number;
}

export interface EventFlight {
  points: THREE.Points;
  targetId: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  mid: THREE.Vector3;
  startSize: number;
  endSize: number;
  startTime: number;
}
