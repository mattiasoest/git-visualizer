export const REPO_BASE_RADIUS = 2.0;
export const REPO_ACTIVITY_MAX = 10;
export const REPO_VISUAL = {
  atmosphere: 0,
  innerGlow: 1,
  outerShell: 2,
  outerWire: 3,
  innerCore: 4,
  particle: 5,
} as const;
export const REPO_RING_SCALE = [2.15, 2.65] as const;
export const EVENT_NODE_BASE_RADIUS = 0.75;
export const FLIGHT_DURATION_MS = 550;
export const FLIGHT_IMPACT_PULSE_MS = 350;
export const REPO_SPAWN_MS = 900;
export const EVENT_SPAWN_MS = 1600;
export const SPAWN_DEFERRED = -1;
export const MAX_ACTIVE_FLIGHTS = 24;
export const EVENT_PARTICLE_SIZE = EVENT_NODE_BASE_RADIUS * 2.2;
export const MERGE_EVENT_THRESHOLD = 1500;
export const GALAXY_SPACING = 110;
export const GALAXY_CORE_RADIUS = 8;
export const MAX_ARCHIVE_EVENTS = 2048;
export const GALAXY_CAMERA_DISTANCE = 58;
export const ACTIVE_CLUSTER_CAMERA_DISTANCE = 78;
