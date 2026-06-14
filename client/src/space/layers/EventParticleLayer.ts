import * as THREE from 'three';
import { eventOrbitOffset, resolveEventOrbitPhaseOffset } from '../utils/clusterLayout';
import {
  createSizedPointsMaterial,
  type SizedPointsMaterial,
} from '../utils/sizedPointMaterial';

const EVENT_NODE_BASE_RADIUS = 0.75;
const EVENT_SPAWN_MS = 1600;
const MAX_EVENTS = 1024;

/** Original PointsMaterial sizes — the core size attribute was never used by Three.js. */
const NORMAL_CORE_MATERIAL_SIZE = 1.4;
const NORMAL_GLOW_MATERIAL_SIZE = 2.8;

const UPGRADED_SIZE_SCALE = 1.4;
const UPGRADED_CORE_SIZE = NORMAL_CORE_MATERIAL_SIZE * UPGRADED_SIZE_SCALE;
const UPGRADED_GLOW_SIZE = NORMAL_GLOW_MATERIAL_SIZE * UPGRADED_SIZE_SCALE * 1.175;
const UPGRADED_GLOW_DARKEN = 0.32;
const UPGRADED_GLOW_OPACITY = 0.58;

export const EVENT_SPAWN_DEFERRED = -1;

export interface EventParticleState {
  id: string;
  parentRepoId: string;
  color: string;
  spawnStartTime: number;
  pulseUntil: number;
  orbitPhaseOffset?: number;
  sizeScale?: number;
  suppressed?: boolean;
  upgraded?: boolean;
}

interface UpgradedPointLayer {
  points: THREE.Points;
  material: SizedPointsMaterial;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
}

function easeOutBack(t: number): number {
  const c1 = 1.60158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function createUpgradedLayer(
  pointSprite: THREE.Texture,
  opacity: number,
  blending: THREE.Blending = THREE.NormalBlending,
): UpgradedPointLayer {
  const material = createSizedPointsMaterial(pointSprite, { opacity, blending });
  const geometry = new THREE.BufferGeometry();
  return {
    points: new THREE.Points(geometry, material),
    material,
    positions: new Float32Array(0),
    colors: new Float32Array(0),
    sizes: new Float32Array(0),
  };
}

export class EventParticleLayer {
  readonly group = new THREE.Group();

  /** Default particles — original PointsMaterial rendering. */
  private pointsCore: THREE.Points;
  private pointsGlow: THREE.Points;
  private corePositions = new Float32Array(0);
  private glowPositions = new Float32Array(0);
  private colors = new Float32Array(0);
  private coreSizes = new Float32Array(0);

  /** Merged burst representatives only — custom sized shader. */
  private upgradedCoreLayer: UpgradedPointLayer;
  private upgradedGlowLayer: UpgradedPointLayer;

  private states = new Map<string, EventParticleState>();
  private order: string[] = [];
  private hiddenIds = new Set<string>();
  private worldPositions = new Map<string, THREE.Vector3>();
  private parentPositions = new Map<string, THREE.Vector3>();
  private readonly scratchColor = new THREE.Color();
  private readonly scratchDark = new THREE.Color();
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
        size: NORMAL_CORE_MATERIAL_SIZE,
        map: pointSprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        depthWrite: false,
        depthTest: false,
        alphaTest: 0.01,
      }),
    );

    this.pointsGlow = new THREE.Points(
      glowGeo,
      new THREE.PointsMaterial({
        size: NORMAL_GLOW_MATERIAL_SIZE,
        map: pointSprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.35,
        sizeAttenuation: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        alphaTest: 0.01,
      }),
    );

    this.upgradedCoreLayer = createUpgradedLayer(pointSprite, 0.95);
    this.upgradedGlowLayer = createUpgradedLayer(pointSprite, UPGRADED_GLOW_OPACITY);

    this.group.add(this.pointsCore);
    this.group.add(this.pointsGlow);
    this.group.add(this.upgradedCoreLayer.points);
    this.group.add(this.upgradedGlowLayer.points);
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
        existing.sizeScale = event.sizeScale;
        existing.suppressed = event.suppressed;
        existing.upgraded = event.upgraded ?? false;
      } else {
        this.states.set(event.id, { ...event, upgraded: event.upgraded ?? false, orbitPhaseOffset: 0 });
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
    this.ensureNormalBuffers(this.order.length);
    this.ensureUpgradedBuffers(this.upgradedCoreLayer, this.order.length);
    this.ensureUpgradedBuffers(this.upgradedGlowLayer, this.order.length);

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

  isSuppressed(id: string): boolean {
    return this.states.get(id)?.suppressed ?? false;
  }

  isHidden(id: string): boolean {
    return this.hiddenIds.has(id);
  }

  getSizeScale(id: string): number {
    return this.states.get(id)?.upgraded ? UPGRADED_SIZE_SCALE : 1;
  }

  isUpgraded(id: string): boolean {
    return this.states.get(id)?.upgraded ?? false;
  }

  beginSpawn(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    state.spawnStartTime = performance.now();
    this.spawnBurstRing(id, state.color, state.upgraded ?? false);
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

  update(time: number, now: number, attenuationScale: number): void {
    const count = this.order.length;
    if (count === 0) {
      this.pointsCore.geometry.setDrawRange(0, 0);
      this.pointsGlow.geometry.setDrawRange(0, 0);
      this.setUpgradedDrawRange(this.upgradedCoreLayer, 0);
      this.setUpgradedDrawRange(this.upgradedGlowLayer, 0);
      return;
    }

    this.ensureNormalBuffers(count);
    this.ensureUpgradedBuffers(this.upgradedCoreLayer, count);
    this.ensureUpgradedBuffers(this.upgradedGlowLayer, count);

    this.upgradedCoreLayer.material.uniforms.scale.value = attenuationScale;
    this.upgradedGlowLayer.material.uniforms.scale.value = attenuationScale;

    let normalCount = 0;
    let upgradedCoreCount = 0;
    let upgradedGlowCount = 0;

    for (let i = 0; i < count; i++) {
      const id = this.order[i]!;
      const state = this.states.get(id);
      if (!state) continue;

      const worldPos = this.computeWorldPosition(id, state, time);
      if (!worldPos) continue;

      const deferred = state.spawnStartTime === EVENT_SPAWN_DEFERRED;
      if (deferred || this.hiddenIds.has(id) || state.suppressed) continue;

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

      const upgraded = state.upgraded === true;

      if (upgraded) {
        const coreSize = UPGRADED_CORE_SIZE * scaleMul;
        this.writeUpgradedPoint(this.upgradedCoreLayer, upgradedCoreCount, worldPos, state.color, coreSize);
        upgradedCoreCount += 1;

        this.scratchColor.set(state.color);
        this.scratchDark.copy(this.scratchColor).multiplyScalar(UPGRADED_GLOW_DARKEN);
        this.writeUpgradedPoint(
          this.upgradedGlowLayer,
          upgradedGlowCount,
          worldPos,
          this.scratchDark,
          UPGRADED_GLOW_SIZE * scaleMul,
        );
        upgradedGlowCount += 1;
        continue;
      }

      const idx = normalCount * 3;
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
      this.coreSizes[normalCount] = EVENT_NODE_BASE_RADIUS * 2.2 * scaleMul;

      normalCount += 1;
    }

    this.markNormalBuffersDirty(normalCount);
    this.markUpgradedBuffersDirty(this.upgradedCoreLayer, upgradedCoreCount);
    this.markUpgradedBuffersDirty(this.upgradedGlowLayer, upgradedGlowCount);
    this.updateBurstRings(now);
  }

  private writeUpgradedPoint(
    layer: UpgradedPointLayer,
    index: number,
    position: THREE.Vector3,
    color: THREE.Color | string,
    size: number,
  ): void {
    const idx = index * 3;
    layer.positions[idx] = position.x;
    layer.positions[idx + 1] = position.y;
    layer.positions[idx + 2] = position.z;

    this.scratchColor.set(color);
    layer.colors[idx] = this.scratchColor.r;
    layer.colors[idx + 1] = this.scratchColor.g;
    layer.colors[idx + 2] = this.scratchColor.b;
    layer.sizes[index] = size;
  }

  private ensureNormalBuffers(count: number): void {
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

  private ensureUpgradedBuffers(layer: UpgradedPointLayer, count: number): void {
    const capped = Math.min(Math.max(count, 1), MAX_EVENTS);
    if (layer.positions.length >= capped * 3 && count > 0) return;

    layer.positions = new Float32Array(capped * 3);
    layer.colors = new Float32Array(capped * 3);
    layer.sizes = new Float32Array(capped);

    const geometry = layer.points.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3));
    geometry.setAttribute('particleColor', new THREE.BufferAttribute(layer.colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(layer.sizes, 1));
  }

  private markNormalBuffersDirty(visibleCount: number): void {
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

  private markUpgradedBuffersDirty(layer: UpgradedPointLayer, visibleCount: number): void {
    const geometry = layer.points.geometry;
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('particleColor') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    this.setUpgradedDrawRange(layer, visibleCount);
  }

  private setUpgradedDrawRange(layer: UpgradedPointLayer, visibleCount: number): void {
    layer.points.geometry.setDrawRange(0, visibleCount);
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

  private spawnBurstRing(eventId: string, color: string, upgraded: boolean): void {
    if (this.burstRings.length >= 8) {
      const oldest = this.burstRings.shift()!;
      this.group.remove(oldest.mesh);
      oldest.material.dispose();
    }
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: upgraded ? 0.95 : 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(EVENT_NODE_BASE_RADIUS * (upgraded ? 0.4 : 0.25));
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
      const upgraded = this.states.get(ring.eventId)?.upgraded === true;
      ring.mesh.position.copy(position);
      ring.mesh.scale.setScalar(
        EVENT_NODE_BASE_RADIUS * ((upgraded ? 0.4 : 0.25) + spawnT * (upgraded ? 8.5 : 6.5)),
      );
      ring.material.opacity = (upgraded ? 0.95 : 0.9) * (1 - spawnT ** 0.85);
      this.burstRings[write++] = ring;
    }
    this.burstRings.length = write;
  }

  dispose(): void {
    this.pointsCore.geometry.dispose();
    (this.pointsCore.material as THREE.Material).dispose();
    this.pointsGlow.geometry.dispose();
    (this.pointsGlow.material as THREE.Material).dispose();
    this.upgradedCoreLayer.points.geometry.dispose();
    this.upgradedCoreLayer.material.dispose();
    this.upgradedGlowLayer.points.geometry.dispose();
    this.upgradedGlowLayer.material.dispose();
    for (const ring of this.burstRings) {
      ring.material.dispose();
    }
    this.burstRings.length = 0;
  }
}
