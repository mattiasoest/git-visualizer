import * as THREE from 'three';
import { eventOrbitOffset, resolveEventOrbitPhaseOffset } from './clusterLayout';

const EVENT_NODE_BASE_RADIUS = 0.75;
const EVENT_SPAWN_MS = 1600;
const MAX_EVENTS = 1024;

export const EVENT_SPAWN_DEFERRED = -1;

export interface EventParticleState {
  id: string;
  parentRepoId: string;
  color: string;
  spawnStartTime: number;
  pulseUntil: number;
  orbitPhaseOffset?: number;
}

function easeOutBack(t: number): number {
  const c1 = 1.60158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export class EventParticleLayer {
  readonly group = new THREE.Group();

  private pointsCore: THREE.Points;
  private pointsGlow: THREE.Points;
  private corePositions = new Float32Array(0);
  private glowPositions = new Float32Array(0);
  private colors = new Float32Array(0);
  private coreSizes = new Float32Array(0);

  private states = new Map<string, EventParticleState>();
  private order: string[] = [];
  private hiddenIds = new Set<string>();
  private worldPositions = new Map<string, THREE.Vector3>();
  private parentPositions = new Map<string, THREE.Vector3>();
  private readonly scratchColor = new THREE.Color();
  private burstRings: {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    startTime: number;
    eventId: string;
  }[] = [];

  constructor(
    pointSprite: THREE.Texture,
    private readonly ringGeo: THREE.BufferGeometry,
  ) {
    const coreGeo = new THREE.BufferGeometry();
    const glowGeo = new THREE.BufferGeometry();

    this.pointsCore = new THREE.Points(
      coreGeo,
      new THREE.PointsMaterial({
        size: 1.4,
        map: pointSprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        depthWrite: false,
        alphaTest: 0.01,
      }),
    );

    this.pointsGlow = new THREE.Points(
      glowGeo,
      new THREE.PointsMaterial({
        size: 2.8,
        map: pointSprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.35,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        alphaTest: 0.01,
      }),
    );

    this.group.add(this.pointsCore);
    this.group.add(this.pointsGlow);
  }

  sync(
    events: EventParticleState[],
    parentPositions: Map<string, THREE.Vector3>,
    time = 0,
  ): void {
    this.parentPositions = parentPositions;

    const nextIds = new Set(events.map((e) => e.id));
    for (const id of this.states.keys()) {
      if (!nextIds.has(id)) this.states.delete(id);
    }
    for (const id of this.worldPositions.keys()) {
      if (!nextIds.has(id)) this.worldPositions.delete(id);
    }

    const newIds: string[] = [];

    for (const event of events) {
      const existing = this.states.get(event.id);
      if (existing) {
        existing.parentRepoId = event.parentRepoId;
        existing.color = event.color;
        existing.spawnStartTime = event.spawnStartTime;
        existing.pulseUntil = event.pulseUntil;
      } else {
        this.states.set(event.id, { ...event, orbitPhaseOffset: 0 });
        newIds.push(event.id);
      }
    }

    for (const id of newIds) {
      const state = this.states.get(id);
      if (!state) continue;
      const siblings = Array.from(this.states.values())
        .filter((s) => s.parentRepoId === state.parentRepoId)
        .map((s) => ({ id: s.id, phaseOffset: s.orbitPhaseOffset ?? 0 }));
      state.orbitPhaseOffset = resolveEventOrbitPhaseOffset(id, time, siblings);
    }

    this.order = events.map((e) => e.id);
    this.ensureBuffers(this.order.length);

    for (const id of this.order) {
      const state = this.states.get(id);
      if (state) this.computeWorldPosition(id, state, time);
    }
  }

  getPosition(id: string): THREE.Vector3 | undefined {
    return this.worldPositions.get(id);
  }

  setWorldPosition(id: string, position: THREE.Vector3): void {
    let worldPos = this.worldPositions.get(id);
    if (!worldPos) {
      worldPos = new THREE.Vector3();
      this.worldPositions.set(id, worldPos);
    }
    worldPos.copy(position);
  }

  isSpawnDeferred(id: string): boolean {
    const state = this.states.get(id);
    return state ? state.spawnStartTime === EVENT_SPAWN_DEFERRED : true;
  }

  beginSpawn(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    state.spawnStartTime = performance.now();
    this.spawnBurstRing(id, state.color);
  }

  setPulseUntil(id: string, until: number): void {
    const state = this.states.get(id);
    if (state) state.pulseUntil = until;
  }

  completeSpawn(id: string): void {
    const state = this.states.get(id);
    if (state) state.spawnStartTime = 0;
  }

  setHidden(ids: Set<string>): void {
    this.hiddenIds = ids;
  }

  advancePositions(time: number): void {
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i]!;
      const state = this.states.get(id);
      if (state) this.computeWorldPosition(id, state, time);
    }
  }

  update(time: number, now: number): void {
    const count = this.order.length;
    if (count === 0) {
      this.pointsCore.geometry.setDrawRange(0, 0);
      this.pointsGlow.geometry.setDrawRange(0, 0);
      return;
    }

    this.ensureBuffers(count);
    let visibleCount = 0;

    for (let i = 0; i < count; i++) {
      const id = this.order[i]!;
      const state = this.states.get(id);
      if (!state) continue;

      const worldPos = this.computeWorldPosition(id, state, time);
      if (!worldPos) continue;

      const deferred = state.spawnStartTime === EVENT_SPAWN_DEFERRED;
      if (deferred || this.hiddenIds.has(id)) continue;

      const spawning =
        state.spawnStartTime > 0 && (now - state.spawnStartTime) / EVENT_SPAWN_MS < 1;
      const spawnT = spawning
        ? Math.min((now - state.spawnStartTime) / EVENT_SPAWN_MS, 1)
        : 1;

      let scaleMul = 1;
      if (spawning) {
        scaleMul = easeOutBack(spawnT);
        if (spawnT >= 1) state.spawnStartTime = 0;
      } else {
        const pulsing = now < state.pulseUntil;
        const pulse = pulsing ? 1 + Math.sin(now * 0.035) * 0.2 : 1;
        const eventPulse = 1 + Math.sin(time * 2.4 + worldPos.z) * 0.06;
        scaleMul = pulse * eventPulse;
      }

      const idx = visibleCount * 3;
      this.corePositions[idx] = worldPos.x;
      this.corePositions[idx + 1] = worldPos.y;
      this.corePositions[idx + 2] = worldPos.z;
      this.glowPositions[idx] = worldPos.x;
      this.glowPositions[idx + 1] = worldPos.y;
      this.glowPositions[idx + 2] = worldPos.z;

      this.scratchColor.set(state.color);
      this.colors[idx] = this.scratchColor.r;
      this.colors[idx + 1] = this.scratchColor.g;
      this.colors[idx + 2] = this.scratchColor.b;
      this.coreSizes[visibleCount] = EVENT_NODE_BASE_RADIUS * 2.2 * scaleMul;

      visibleCount += 1;
    }

    this.markBuffersDirty(visibleCount);
    this.updateBurstRings(now);
  }

  private ensureBuffers(count: number): void {
    const capped = Math.min(Math.max(count, 1), MAX_EVENTS);
    if (this.corePositions.length >= capped * 3 && count > 0) return;

    this.corePositions = new Float32Array(capped * 3);
    this.glowPositions = new Float32Array(capped * 3);
    this.colors = new Float32Array(capped * 3);
    this.coreSizes = new Float32Array(capped);

    const coreGeo = this.pointsCore.geometry;
    coreGeo.setAttribute('position', new THREE.BufferAttribute(this.corePositions, 3));
    coreGeo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    coreGeo.setAttribute('size', new THREE.BufferAttribute(this.coreSizes, 1));

    const glowGeo = this.pointsGlow.geometry;
    glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPositions, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
  }

  private markBuffersDirty(visibleCount: number): void {
    const coreGeo = this.pointsCore.geometry;
    const glowGeo = this.pointsGlow.geometry;
    (coreGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (coreGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (coreGeo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (glowGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (glowGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    coreGeo.setDrawRange(0, visibleCount);
    glowGeo.setDrawRange(0, visibleCount);
  }

  private computeWorldPosition(
    id: string,
    state: EventParticleState,
    time: number,
  ): THREE.Vector3 | null {
    const parentPos = this.parentPositions.get(state.parentRepoId);
    if (!parentPos) return null;
    let worldPos = this.worldPositions.get(id);
    if (!worldPos) {
      worldPos = new THREE.Vector3();
      this.worldPositions.set(id, worldPos);
    }
    return worldPos.copy(parentPos).add(eventOrbitOffset(id, time, state.orbitPhaseOffset ?? 0));
  }

  private spawnBurstRing(eventId: string, color: string): void {
    if (this.burstRings.length >= 8) {
      const oldest = this.burstRings.shift()!;
      this.group.remove(oldest.mesh);
      oldest.material.dispose();
    }
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(EVENT_NODE_BASE_RADIUS * 0.25);
    const position = this.worldPositions.get(eventId);
    if (position) mesh.position.copy(position);
    this.group.add(mesh);
    this.burstRings.push({ mesh, material, startTime: performance.now(), eventId });
  }

  private updateBurstRings(now: number): void {
    let write = 0;
    for (let i = 0; i < this.burstRings.length; i++) {
      const ring = this.burstRings[i]!;
      const spawnT = Math.min((now - ring.startTime) / EVENT_SPAWN_MS, 1);
      if (spawnT >= 1) {
        this.group.remove(ring.mesh);
        ring.material.dispose();
        continue;
      }
      const position = this.worldPositions.get(ring.eventId);
      if (!position) {
        this.group.remove(ring.mesh);
        ring.material.dispose();
        continue;
      }
      ring.mesh.position.copy(position);
      ring.mesh.scale.setScalar(EVENT_NODE_BASE_RADIUS * (0.25 + spawnT * 6.5));
      ring.material.opacity = 0.9 * (1 - spawnT ** 0.85);
      this.burstRings[write++] = ring;
    }
    this.burstRings.length = write;
  }

  dispose(): void {
    this.pointsCore.geometry.dispose();
    (this.pointsCore.material as THREE.Material).dispose();
    this.pointsGlow.geometry.dispose();
    (this.pointsGlow.material as THREE.Material).dispose();
    for (const ring of this.burstRings) {
      ring.material.dispose();
    }
    this.burstRings.length = 0;
  }
}
