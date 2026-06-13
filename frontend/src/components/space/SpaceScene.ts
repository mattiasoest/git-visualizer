import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphData, GraphLink, GraphNode } from './graphBuilder';
import { createLabelSprite, disposeLabelTextures } from './labelSprite';
import { softCircleSprite } from './softSprite';

const ACTOR_BASE_RADIUS = 2.2;
const REPO_BASE_RADIUS = 1.8;
const COMET_DURATION_MS = 2200;
const MAX_ACTIVE_COMETS = 10;
const TRAIL_POINTS = 10;

interface NodeState {
  node: GraphNode;
  anchor: THREE.Group;
  visual: THREE.Group;
  label: THREE.Sprite;
  position: THREE.Vector3;
  pulseUntil: number;
  baseRadius: number;
  ringMesh?: THREE.Mesh;
}

interface Comet {
  mesh: THREE.Mesh;
  trail: THREE.Points;
  trailPositions: Float32Array;
  trailHead: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  mid: THREE.Vector3;
  color: THREE.Color;
  startTime: number;
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchD = new THREE.Vector3();
const scratchE = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchTangent1 = new THREE.Vector3();
const scratchTangent2 = new THREE.Vector3();

function hashToUnitVector(id: string): THREE.Vector3 {
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

const REPO_ORBIT_BASE = 36;
const REPO_ORBIT_SPREAD = 0.6;
const ACTOR_CLUSTER_RADIUS = 6;

function computeNodePositions(
  nodes: GraphNode[],
  links: GraphLink[],
): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const repos = nodes.filter((n) => n.kind === 'repo');
  const actors = nodes.filter((n) => n.kind === 'actor');

  const actorToRepos = new Map<string, { repoId: string; weight: number }[]>();
  for (const link of links) {
    const list = actorToRepos.get(link.sourceId) ?? [];
    list.push({ repoId: link.targetId, weight: link.weight });
    actorToRepos.set(link.sourceId, list);
  }

  for (const repo of repos) {
    const direction = hashToUnitVector(repo.id);
    scratchA.copy(direction).normalize().multiplyScalar(
      REPO_ORBIT_BASE + Math.min(repo.eventCount, 8) * REPO_ORBIT_SPREAD,
    );
    positions.set(repo.id, scratchA.clone());
  }

  for (const actor of actors) {
    const connections = actorToRepos.get(actor.id);
    if (!connections || connections.length === 0) {
      scratchA.copy(hashToUnitVector(actor.id)).normalize().multiplyScalar(22);
      positions.set(actor.id, scratchA.clone());
      continue;
    }

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

function createLinkGeometry(source: THREE.Vector3, target: THREE.Vector3): THREE.BufferGeometry {
  const positions = new Float32Array([
    source.x,
    source.y,
    source.z,
    target.x,
    target.y,
    target.z,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function updateLinkEndpoints(
  line: THREE.Line,
  source: THREE.Vector3,
  target: THREE.Vector3,
): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  arr[0] = source.x;
  arr[1] = source.y;
  arr[2] = source.z;
  arr[3] = target.x;
  arr[4] = target.y;
  arr[5] = target.z;
  attr.needsUpdate = true;
}

export class SpaceScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private autoRotateListeners = new Set<(enabled: boolean) => void>();
  private clock = new THREE.Clock();
  private nodeStates = new Map<string, NodeState>();
  private linkLines = new Map<string, THREE.Line>();
  private linkGroup = new THREE.Group();
  private comets: Comet[] = [];
  private cometGroup = new THREE.Group();
  private starfield: THREE.Points;
  private nebula: THREE.Points;
  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private positions = new Map<string, THREE.Vector3>();
  private nodeTopology = new Set<string>();
  private linkTopology = new Set<string>();
  private pointSprite = softCircleSprite();
  private isVisible = true;
  private cometPosition = new THREE.Vector3();
  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible) {
      this.clock.getDelta();
      this.renderer.setAnimationLoop(this.animate);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  };

  private readonly actorCoreGeo = new THREE.SphereGeometry(1, 16, 16);
  private readonly actorGlowGeo = new THREE.SphereGeometry(1, 10, 10);
  private readonly actorRingGeo = new THREE.RingGeometry(1, 1.1, 24);
  private readonly repoCrystalGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly repoOrbitGeo = new THREE.TorusGeometry(1, 0.033, 6, 32);
  private readonly repoGlowGeo = new THREE.SphereGeometry(1, 8, 8);
  private readonly cometGeo = new THREE.SphereGeometry(0.35, 8, 8);

  private readonly actorCoreMat = new THREE.MeshBasicMaterial({ color: 0x4a9eff });
  private readonly actorGlowMat = new THREE.MeshBasicMaterial({
    color: 0x58a6ff,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly actorRingMat = new THREE.MeshBasicMaterial({
    color: 0x79c0ff,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoCrystalMat = new THREE.MeshBasicMaterial({ color: 0x3fb950 });
  private readonly repoOrbitMat = new THREE.MeshBasicMaterial({
    color: 0x56d364,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoGlowMat = new THREE.MeshBasicMaterial({
    color: 0x238636,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly cometMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly trailMat = new THREE.PointsMaterial({
    size: 1.6,
    map: this.pointSprite,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    alphaTest: 0.01,
  });

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x020014, 0.0035);

    const { clientWidth, clientHeight } = container;
    this.camera = new THREE.PerspectiveCamera(55, clientWidth / clientHeight, 0.1, 500);
    this.camera.position.set(0, 35, 95);

    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(clientWidth, clientHeight);
    this.renderer.setClearColor(0x020014, 1);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 180;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => {
      this.setAutoRotate(false);
    });

    const ambient = new THREE.AmbientLight(0x6a7aaa, 1.1);
    this.scene.add(ambient);

    this.starfield = this.createStarfield(2500);
    this.scene.add(this.starfield);

    this.nebula = this.createNebula(120);
    this.scene.add(this.nebula);

    this.scene.add(this.linkGroup);
    this.scene.add(this.cometGroup);

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(this.animate);
  }

  private createStarfield(count: number): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const radius = 120 + Math.random() * 180;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      const tint = Math.random();
      if (tint < 0.15) color.setHSL(0.75, 0.5, 0.75);
      else if (tint < 0.3) color.setHSL(0.58, 0.45, 0.8);
      else color.setHSL(0.6, 0.1, 0.85 + Math.random() * 0.15);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.55,
      map: this.pointSprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      alphaTest: 0.01,
    });

    return new THREE.Points(geometry, material);
  }

  private createNebula(count: number): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;

      const hue = 0.72 + Math.random() * 0.15;
      color.setHSL(hue, 0.7, 0.35 + Math.random() * 0.2);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 14,
      map: this.pointSprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.12,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01,
    });

    return new THREE.Points(geometry, material);
  }

  private loadAvatarTexture(url: string, onReady: (texture: THREE.Texture) => void): void {
    const cached = this.textureCache.get(url);
    if (cached) {
      onReady(cached);
      return;
    }

    this.textureLoader.setCrossOrigin('anonymous');
    this.textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textureCache.set(url, texture);
        onReady(texture);
      },
      undefined,
      () => {},
    );
  }

  private actorRadius(eventCount: number): number {
    return ACTOR_BASE_RADIUS + Math.min(eventCount, 8) * 0.12;
  }

  private repoRadius(eventCount: number): number {
    return REPO_BASE_RADIUS + Math.min(eventCount, 10) * 0.1;
  }

  private applyActorScales(visual: THREE.Group, radius: number, hasAvatar: boolean): void {
    let index = 0;
    visual.children[index].scale.setScalar(radius);
    index += 1;
    if (hasAvatar) {
      visual.children[index].scale.setScalar(radius * 0.92);
      index += 1;
    }
    visual.children[index].scale.setScalar(radius * 1.35);
    index += 1;
    visual.children[index].scale.setScalar(radius * 1.5);
  }

  private applyRepoScales(visual: THREE.Group, scale: number): void {
    visual.children[0].scale.setScalar(scale);
    visual.children[1].scale.setScalar(scale * 1.8);
    visual.children[2].scale.setScalar(scale * 1.6);
  }

  private createActorMesh(node: GraphNode): { group: THREE.Group; ring: THREE.Mesh; baseRadius: number } {
    const group = new THREE.Group();
    const radius = this.actorRadius(node.eventCount);

    const core = new THREE.Mesh(this.actorCoreGeo, this.actorCoreMat);
    core.scale.setScalar(radius);
    group.add(core);

    if (node.avatarUrl) {
      const avatarMaterial = new THREE.MeshBasicMaterial({ transparent: true });
      const avatar = new THREE.Mesh(this.actorCoreGeo, avatarMaterial);
      avatar.scale.setScalar(radius * 0.92);
      avatar.visible = false;
      group.add(avatar);

      this.loadAvatarTexture(node.avatarUrl, (texture) => {
        avatarMaterial.map = texture;
        avatarMaterial.needsUpdate = true;
        avatar.visible = true;
      });
    }

    const glow = new THREE.Mesh(this.actorGlowGeo, this.actorGlowMat);
    glow.scale.setScalar(radius * 1.35);
    group.add(glow);

    const ring = new THREE.Mesh(this.actorRingGeo, this.actorRingMat);
    ring.scale.setScalar(radius * 1.5);
    ring.rotation.x = Math.PI / 2 + 0.4;
    group.add(ring);

    return { group, ring, baseRadius: radius };
  }

  private createRepoMesh(node: GraphNode): { group: THREE.Group; baseRadius: number } {
    const group = new THREE.Group();
    const scale = this.repoRadius(node.eventCount);

    const crystal = new THREE.Mesh(this.repoCrystalGeo, this.repoCrystalMat);
    crystal.scale.setScalar(scale);
    group.add(crystal);

    const orbit = new THREE.Mesh(this.repoOrbitGeo, this.repoOrbitMat);
    orbit.scale.setScalar(scale * 1.8);
    orbit.rotation.x = Math.PI / 3;
    orbit.rotation.y = 0.5;
    group.add(orbit);

    const glow = new THREE.Mesh(this.repoGlowGeo, this.repoGlowMat);
    glow.scale.setScalar(scale * 1.6);
    group.add(glow);

    return { group, baseRadius: scale };
  }

  private removeNodeState(state: NodeState): void {
    (state.label.material as THREE.SpriteMaterial).dispose();
    this.scene.remove(state.anchor);
  }

  private updateLabelSprite(state: NodeState, text: string, kind: 'actor' | 'repo'): void {
    (state.label.material as THREE.SpriteMaterial).dispose();
    state.anchor.remove(state.label);

    const label = createLabelSprite(text, kind);
    label.position.set(0, kind === 'actor' ? 3.2 : 2.6, 0);
    state.anchor.add(label);
    state.label = label;
  }

  private upsertNode(node: GraphNode, position: THREE.Vector3): NodeState {
    const existing = this.nodeStates.get(node.id);

    if (existing) {
      const eventCountChanged = existing.node.eventCount !== node.eventCount;
      const labelChanged = existing.node.label !== node.label;
      existing.node = node;
      existing.position.copy(position);
      existing.anchor.position.copy(position);

      if (eventCountChanged) {
        if (node.kind === 'actor') {
          const radius = this.actorRadius(node.eventCount);
          existing.baseRadius = radius;
          this.applyActorScales(existing.visual, radius, Boolean(node.avatarUrl));
        } else {
          const scale = this.repoRadius(node.eventCount);
          existing.baseRadius = scale;
          this.applyRepoScales(existing.visual, scale);
        }
      }

      if (labelChanged) {
        this.updateLabelSprite(existing, node.label, node.kind);
      }
      return existing;
    }

    const anchor = new THREE.Group();
    anchor.position.copy(position);
    this.scene.add(anchor);

    let visual: THREE.Group;
    let baseRadius: number;
    let ringMesh: THREE.Mesh | undefined;

    if (node.kind === 'actor') {
      const actorMesh = this.createActorMesh(node);
      visual = actorMesh.group;
      baseRadius = actorMesh.baseRadius;
      ringMesh = actorMesh.ring;
    } else {
      const repoMesh = this.createRepoMesh(node);
      visual = repoMesh.group;
      baseRadius = repoMesh.baseRadius;
    }

    anchor.add(visual);

    const label = createLabelSprite(node.label, node.kind);
    label.position.set(0, node.kind === 'actor' ? 3.2 : 2.6, 0);
    anchor.add(label);

    const state: NodeState = {
      node,
      anchor,
      visual,
      label,
      position,
      pulseUntil: 0,
      baseRadius,
      ringMesh,
    };
    this.nodeStates.set(node.id, state);
    return state;
  }

  private syncLinks(links: GraphLink[]): void {
    const nextKeys = new Set(links.map((link) => link.key));

    for (const [key, line] of this.linkLines) {
      if (nextKeys.has(key)) continue;
      this.linkGroup.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.linkLines.delete(key);
    }

    for (const link of links) {
      const source = this.nodeStates.get(link.sourceId);
      const target = this.nodeStates.get(link.targetId);
      if (!source || !target) continue;

      const opacity = 0.15 + Math.min(link.weight, 6) * 0.04;
      const existing = this.linkLines.get(link.key);
      if (existing) {
        (existing.material as THREE.LineBasicMaterial).opacity = opacity;
        updateLinkEndpoints(existing, source.position, target.position);
        continue;
      }

      const geometry = createLinkGeometry(source.position, target.position);
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(link.color),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      this.linkGroup.add(line);
      this.linkLines.set(link.key, line);
    }
  }

  private topologyChanged(activeIds: Set<string>, linkKeys: Set<string>): boolean {
    if (activeIds.size !== this.nodeTopology.size || linkKeys.size !== this.linkTopology.size) {
      return true;
    }
    for (const id of activeIds) {
      if (!this.nodeTopology.has(id)) return true;
    }
    for (const key of linkKeys) {
      if (!this.linkTopology.has(key)) return true;
    }
    return false;
  }

  updateGraph(data: GraphData): void {
    const activeIds = new Set(data.nodes.map((n) => n.id));
    const linkKeys = new Set(data.links.map((l) => l.key));
    const topologyChanged = this.topologyChanged(activeIds, linkKeys);

    if (topologyChanged) {
      for (const [id, state] of this.nodeStates) {
        if (activeIds.has(id)) continue;
        this.removeNodeState(state);
        this.positions.delete(id);
        this.nodeStates.delete(id);
      }
    }

    if (data.nodes.length === 0) {
      this.clearComets();
    }

    this.positions = computeNodePositions(data.nodes, data.links);

    for (const node of data.nodes) {
      const position = this.positions.get(node.id);
      if (!position) continue;
      this.upsertNode(node, position);
    }

    this.syncLinks(data.links);
    this.updateLabelVisibility(data.nodes.length > 0);

    this.nodeTopology = activeIds;
    this.linkTopology = linkKeys;
  }

  private updateLabelVisibility(visible: boolean): void {
    for (const state of this.nodeStates.values()) {
      state.label.visible = visible;
    }
  }

  private clearComets(): void {
    for (const comet of this.comets) {
      this.cometGroup.remove(comet.mesh);
      this.cometGroup.remove(comet.trail);
      (comet.mesh.material as THREE.Material).dispose();
      comet.trail.geometry.dispose();
      (comet.trail.material as THREE.Material).dispose();
    }
    this.comets.length = 0;
  }

  spawnComet(sourceId: string, targetId: string, color: string): void {
    if (this.comets.length >= MAX_ACTIVE_COMETS) return;

    const source = this.nodeStates.get(sourceId);
    const target = this.nodeStates.get(targetId);
    if (!source || !target) return;

    const from = source.position.clone();
    const to = target.position.clone();
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y += from.distanceTo(to) * 0.15;
    const cometColor = new THREE.Color(color);

    const mesh = new THREE.Mesh(this.cometGeo, this.cometMat.clone());
    (mesh.material as THREE.MeshBasicMaterial).color.copy(cometColor);
    mesh.position.copy(from);

    const trailPositions = new Float32Array(TRAIL_POINTS * 3);
    for (let i = 0; i < TRAIL_POINTS; i++) {
      trailPositions[i * 3] = from.x;
      trailPositions[i * 3 + 1] = from.y;
      trailPositions[i * 3 + 2] = from.z;
    }

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trail = new THREE.Points(trailGeometry, this.trailMat.clone());
    (trail.material as THREE.PointsMaterial).color.copy(cometColor);

    this.cometGroup.add(mesh);
    this.cometGroup.add(trail);

    this.comets.push({
      mesh,
      trail,
      trailPositions,
      trailHead: 0,
      from,
      to,
      mid,
      color: cometColor,
      startTime: performance.now(),
    });

    const pulseUntil = performance.now() + 800;
    source.pulseUntil = pulseUntil;
    target.pulseUntil = pulseUntil;
  }

  getAutoRotate(): boolean {
    return this.controls.autoRotate;
  }

  setAutoRotate(enabled: boolean): void {
    if (this.controls.autoRotate === enabled) return;
    this.controls.autoRotate = enabled;
    for (const listener of this.autoRotateListeners) {
      listener(enabled);
    }
  }

  onAutoRotateChange(listener: (enabled: boolean) => void): () => void {
    this.autoRotateListeners.add(listener);
    return () => {
      this.autoRotateListeners.delete(listener);
    };
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private updateComets(now: number): void {
    let writeIndex = 0;

    for (let i = 0; i < this.comets.length; i++) {
      const comet = this.comets[i];
      const elapsed = now - comet.startTime;
      const t = Math.min(elapsed / COMET_DURATION_MS, 1);
      const eased = 1 - (1 - t) ** 3;

      const oneMinusT = 1 - eased;
      const omt2 = oneMinusT * oneMinusT;
      const e2 = eased * eased;
      const pos = this.cometPosition;
      pos.x = omt2 * comet.from.x + 2 * oneMinusT * eased * comet.mid.x + e2 * comet.to.x;
      pos.y = omt2 * comet.from.y + 2 * oneMinusT * eased * comet.mid.y + e2 * comet.to.y;
      pos.z = omt2 * comet.from.z + 2 * oneMinusT * eased * comet.mid.z + e2 * comet.to.z;

      comet.mesh.position.copy(pos);

      comet.trailHead = (comet.trailHead + 1) % TRAIL_POINTS;
      const idx = comet.trailHead * 3;
      comet.trailPositions[idx] = pos.x;
      comet.trailPositions[idx + 1] = pos.y;
      comet.trailPositions[idx + 2] = pos.z;
      comet.trail.geometry.attributes.position.needsUpdate = true;

      if (t < 1) {
        this.comets[writeIndex++] = comet;
      } else {
        this.cometGroup.remove(comet.mesh);
        this.cometGroup.remove(comet.trail);
        (comet.mesh.material as THREE.Material).dispose();
        comet.trail.geometry.dispose();
        (comet.trail.material as THREE.Material).dispose();
      }
    }

    this.comets.length = writeIndex;
  }

  private updateNodes(now: number): void {
    const time = this.clock.getElapsedTime();

    for (const state of this.nodeStates.values()) {
      const isPulsing = now < state.pulseUntil;
      const isRepo = state.node.kind === 'repo';

      if (isPulsing || isRepo) {
        const pulse = isPulsing ? 1 + Math.sin(now * 0.02) * 0.15 : 1;
        const breathe = isRepo ? 1 + Math.sin(time * 1.2 + state.position.x) * 0.03 : 1;
        state.visual.scale.setScalar(pulse * breathe);
      } else if (state.visual.scale.x !== 1) {
        state.visual.scale.setScalar(1);
      }

      if (isRepo) {
        state.visual.rotation.y = time * 0.4;
        state.visual.rotation.x = Math.sin(time * 0.3) * 0.2;
      } else if (state.ringMesh) {
        state.ringMesh.rotation.z = time * 0.5;
      }
    }

    this.starfield.rotation.y = time * 0.008;
    this.nebula.rotation.y = -time * 0.003;
  }

  private animate = (): void => {
    if (!this.isVisible) return;

    const now = performance.now();

    this.controls.update();
    this.updateComets(now);
    this.updateNodes(now);

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();

    for (const state of this.nodeStates.values()) {
      this.removeNodeState(state);
    }
    this.nodeStates.clear();

    for (const line of this.linkLines.values()) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.linkLines.clear();

    for (const comet of this.comets) {
      (comet.mesh.material as THREE.Material).dispose();
      comet.trail.geometry.dispose();
      (comet.trail.material as THREE.Material).dispose();
    }

    this.starfield.geometry.dispose();
    (this.starfield.material as THREE.Material).dispose();
    this.nebula.geometry.dispose();
    (this.nebula.material as THREE.Material).dispose();

    this.actorCoreGeo.dispose();
    this.actorGlowGeo.dispose();
    this.actorRingGeo.dispose();
    this.repoCrystalGeo.dispose();
    this.repoOrbitGeo.dispose();
    this.repoGlowGeo.dispose();
    this.cometGeo.dispose();

    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }

    disposeLabelTextures();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
