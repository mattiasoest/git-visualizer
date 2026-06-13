import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphData, GraphLink, GraphNode } from './graphBuilder';
import { computeHierarchicalPositions, eventOrbitOffset } from './clusterLayout';
import { createCommitLabelSprite, createLabelSprite, disposeCommitLabel, disposeLabelTextures } from './labelSprite';
import { softCircleSprite } from './softSprite';

const ACTOR_BASE_RADIUS = 2.2;
const REPO_BASE_RADIUS = 1.8;
const EVENT_NODE_BASE_RADIUS = 0.75;
const COMET_DURATION_MS = 550;
const COMET_IMPACT_PULSE_MS = 350;
const ACTOR_SPAWN_MS = 900;
const REPO_SPAWN_MS = 900;
const EVENT_SPAWN_MS = 1600;
const SPAWN_DEFERRED = -1;
const MAX_ACTIVE_COMETS = 24;
const TRAIL_POINTS = 10;

interface QueuedComet {
  sourceId: string;
  targetId: string;
  color: string;
  commitMessage?: string;
}

interface NodeState {
  node: GraphNode;
  anchor: THREE.Group;
  visual: THREE.Group;
  label: THREE.Sprite;
  position: THREE.Vector3;
  pulseUntil: number;
  tintUntil: number;
  tintColor?: THREE.Color;
  actorMaterials?: {
    core: THREE.MeshBasicMaterial;
    glow: THREE.MeshBasicMaterial;
    ring: THREE.MeshBasicMaterial;
    avatar?: THREE.MeshBasicMaterial;
  };
  actorBaseColors?: {
    core: THREE.Color;
    glow: THREE.Color;
    ring: THREE.Color;
  };
  spawnStartTime: number;
  baseRadius: number;
  ringMesh?: THREE.Mesh;
  eventMaterials?: {
    core: THREE.MeshBasicMaterial;
    glow: THREE.MeshBasicMaterial;
  };
  spawnBurstRing?: {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
  };
}

interface Comet {
  mesh: THREE.Mesh;
  trail: THREE.Points;
  trailPositions: Float32Array;
  trailHead: number;
  targetId: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  mid: THREE.Vector3;
  color: THREE.Color;
  startTime: number;
  label?: THREE.Sprite;
}


function easeOutBack(t: number): number {
  const c1 = 1.60158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
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
  private linkBaseOpacity = new Map<string, number>();
  private linkGroup = new THREE.Group();
  private comets: Comet[] = [];
  private cometQueue: QueuedComet[] = [];
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
  private readonly eventCoreGeo = new THREE.OctahedronGeometry(1, 0);
  private readonly eventGlowGeo = new THREE.SphereGeometry(1, 8, 8);
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
    this.renderer.setClearColor(0x020014, 1);
    container.appendChild(this.renderer.domElement);

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    this.resize();

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

  private eventNodeRadius(): number {
    return EVENT_NODE_BASE_RADIUS;
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

  private createActorMesh(node: GraphNode): {
    group: THREE.Group;
    ring: THREE.Mesh;
    baseRadius: number;
    materials: {
      core: THREE.MeshBasicMaterial;
      glow: THREE.MeshBasicMaterial;
      ring: THREE.MeshBasicMaterial;
      avatar?: THREE.MeshBasicMaterial;
    };
    baseColors: { core: THREE.Color; glow: THREE.Color; ring: THREE.Color };
  } {
    const group = new THREE.Group();
    const radius = this.actorRadius(node.eventCount);

    const coreMat = this.actorCoreMat.clone();
    const core = new THREE.Mesh(this.actorCoreGeo, coreMat);
    core.scale.setScalar(radius);
    group.add(core);

    let avatarMat: THREE.MeshBasicMaterial | undefined;
    if (node.avatarUrl) {
      avatarMat = new THREE.MeshBasicMaterial({ transparent: true, color: 0xffffff });
      const avatar = new THREE.Mesh(this.actorCoreGeo, avatarMat);
      avatar.scale.setScalar(radius * 0.92);
      avatar.visible = false;
      group.add(avatar);

      this.loadAvatarTexture(node.avatarUrl, (texture) => {
        avatarMat!.map = texture;
        avatarMat!.needsUpdate = true;
        avatar.visible = true;
      });
    }

    const glowMat = this.actorGlowMat.clone();
    const glow = new THREE.Mesh(this.actorGlowGeo, glowMat);
    glow.scale.setScalar(radius * 1.35);
    group.add(glow);

    const ringMat = this.actorRingMat.clone();
    const ring = new THREE.Mesh(this.actorRingGeo, ringMat);
    ring.scale.setScalar(radius * 1.5);
    ring.rotation.x = Math.PI / 2 + 0.4;
    group.add(ring);

    return {
      group,
      ring,
      baseRadius: radius,
      materials: { core: coreMat, glow: glowMat, ring: ringMat, avatar: avatarMat },
      baseColors: {
        core: coreMat.color.clone(),
        glow: glowMat.color.clone(),
        ring: ringMat.color.clone(),
      },
    };
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

  private createEventMesh(node: GraphNode): {
    group: THREE.Group;
    baseRadius: number;
    materials: { core: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial };
  } {
    const group = new THREE.Group();
    const radius = this.eventNodeRadius();
    const color = new THREE.Color(node.color ?? '#8b949e');

    const coreMat = new THREE.MeshBasicMaterial({ color });
    const core = new THREE.Mesh(this.eventCoreGeo, coreMat);
    core.scale.setScalar(radius);
    group.add(core);

    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(this.eventGlowGeo, glowMat);
    glow.scale.setScalar(radius * 1.8);
    group.add(glow);

    return { group, baseRadius: radius, materials: { core: coreMat, glow: glowMat } };
  }

  private disposeEventMaterials(visual: THREE.Group): void {
    for (const child of visual.children) {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.Material).dispose();
      }
    }
  }

  private disposeNodeLabel(state: NodeState): void {
    if (state.node.kind === 'event' && state.node.label) {
      disposeCommitLabel(state.label);
      return;
    }
    (state.label.material as THREE.SpriteMaterial).dispose();
  }

  private syncEventLabel(state: NodeState, node: GraphNode): void {
    if (state.label) {
      this.disposeNodeLabel(state);
      state.anchor.remove(state.label);
    }

    if (!node.label) {
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
      label.visible = false;
      state.anchor.add(label);
      state.label = label;
      return;
    }

    const label = createCommitLabelSprite(node.label, node.color ?? '#8b949e');
    label.position.set(0, -1.9, 0);
    state.anchor.add(label);
    state.label = label;
  }

  private disposeActorMaterials(state: NodeState): void {
    if (!state.actorMaterials) return;
    state.actorMaterials.core.dispose();
    state.actorMaterials.glow.dispose();
    state.actorMaterials.ring.dispose();
    state.actorMaterials.avatar?.dispose();
    state.actorMaterials = undefined;
    state.actorBaseColors = undefined;
  }

  private applyActorTint(state: NodeState, now: number): void {
    if (!state.actorMaterials || !state.actorBaseColors) return;

    const { core, glow, ring, avatar } = state.actorMaterials;
    const bases = state.actorBaseColors;

    if (!state.tintColor || now >= state.tintUntil) {
      core.color.copy(bases.core);
      glow.color.copy(bases.glow);
      ring.color.copy(bases.ring);
      if (avatar) avatar.color.set(0xffffff);
      return;
    }

    const elapsed = COMET_IMPACT_PULSE_MS - (state.tintUntil - now);
    const intensity = Math.sin(Math.min(Math.max(elapsed / COMET_IMPACT_PULSE_MS, 0), 1) * Math.PI);

    core.color.copy(bases.core).lerp(state.tintColor, intensity);
    glow.color.copy(bases.glow).lerp(state.tintColor, intensity);
    ring.color.copy(bases.ring).lerp(state.tintColor, intensity);
    if (avatar) {
      avatar.color.set(0xffffff).lerp(state.tintColor, intensity * 0.75);
    }
  }

  private removeNodeState(state: NodeState): void {
    this.disposeSpawnBurstRing(state);
    if (state.node.kind === 'event') {
      this.disposeEventMaterials(state.visual);
    } else if (state.node.kind === 'actor') {
      this.disposeActorMaterials(state);
    }
    this.disposeNodeLabel(state);
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
        } else if (node.kind === 'repo') {
          const scale = this.repoRadius(node.eventCount);
          existing.baseRadius = scale;
          this.applyRepoScales(existing.visual, scale);
        }
      }

      if (labelChanged && node.kind === 'actor') {
        this.updateLabelSprite(existing, node.label, node.kind);
      } else if (labelChanged && node.kind === 'repo') {
        this.updateLabelSprite(existing, node.label, node.kind);
      } else if (labelChanged && node.kind === 'event') {
        this.syncEventLabel(existing, node);
      }
      return existing;
    }

    const anchor = new THREE.Group();
    anchor.position.copy(position);
    this.scene.add(anchor);

    let visual: THREE.Group;
    let baseRadius: number;
    let ringMesh: THREE.Mesh | undefined;
    let actorMaterials: NodeState['actorMaterials'];
    let actorBaseColors: NodeState['actorBaseColors'];
    let eventMaterials: NodeState['eventMaterials'];

    if (node.kind === 'actor') {
      const actorMesh = this.createActorMesh(node);
      visual = actorMesh.group;
      baseRadius = actorMesh.baseRadius;
      ringMesh = actorMesh.ring;
      actorMaterials = actorMesh.materials;
      actorBaseColors = actorMesh.baseColors;
    } else if (node.kind === 'repo') {
      const repoMesh = this.createRepoMesh(node);
      visual = repoMesh.group;
      baseRadius = repoMesh.baseRadius;
    } else {
      const eventMesh = this.createEventMesh(node);
      visual = eventMesh.group;
      baseRadius = eventMesh.baseRadius;
      eventMaterials = eventMesh.materials;
    }

    anchor.add(visual);

    if (node.kind === 'actor' || node.kind === 'repo' || node.kind === 'event') {
      visual.scale.setScalar(0);
    }

    let label: THREE.Sprite;
    if (node.kind === 'event') {
      label = node.label
        ? createCommitLabelSprite(node.label, node.color ?? '#8b949e')
        : new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
      if (node.label) {
        label.position.set(0, -1.9, 0);
      }
      label.visible = false;
    } else {
      label = createLabelSprite(node.label, node.kind);
      label.position.set(0, node.kind === 'actor' ? 3.2 : 2.6, 0);
    }
    anchor.add(label);

    if (node.kind === 'actor' || node.kind === 'repo') {
      (label.material as THREE.SpriteMaterial).opacity = 0;
    }

    const spawnStartTime =
      node.kind === 'actor' || node.kind === 'repo' || node.kind === 'event' ? SPAWN_DEFERRED : 0;

    const state: NodeState = {
      node,
      anchor,
      visual,
      label,
      position,
      pulseUntil: 0,
      tintUntil: 0,
      actorMaterials,
      actorBaseColors,
      spawnStartTime,
      baseRadius,
      ringMesh,
      eventMaterials,
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
      this.linkBaseOpacity.delete(key);
    }

    for (const link of links) {
      const source = this.nodeStates.get(link.sourceId);
      const target = this.nodeStates.get(link.targetId);
      if (!source || !target) continue;

      const isTether = link.kind === 'tether';
      const baseOpacity = isTether
        ? 0.22 + Math.min(link.weight, 4) * 0.03
        : 0.15 + Math.min(link.weight, 6) * 0.04;
      this.linkBaseOpacity.set(link.key, baseOpacity);
      const visible = !this.isSpawnDeferred(source) && !this.isSpawnDeferred(target);
      const existing = this.linkLines.get(link.key);
      if (existing) {
        (existing.material as THREE.LineBasicMaterial).opacity = visible ? baseOpacity : 0;
        updateLinkEndpoints(existing, source.position, target.position);
        continue;
      }

      const geometry = createLinkGeometry(source.position, target.position);
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(link.color),
        transparent: true,
        opacity: visible ? baseOpacity : 0,
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

    this.positions = computeHierarchicalPositions(data.nodes, data.links);

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
      if (this.isSpawnDeferred(state)) {
        state.label.visible = false;
        continue;
      }
      if (state.node.kind === 'event') {
        state.label.visible = visible && Boolean(state.node.label);
      } else {
        state.label.visible = visible;
      }
    }
  }

  private clearComets(): void {
    for (const comet of this.comets) {
      this.disposeComet(comet);
    }
    this.comets.length = 0;
    this.cometQueue.length = 0;
  }

  private disposeComet(comet: Comet): void {
    this.cometGroup.remove(comet.mesh);
    this.cometGroup.remove(comet.trail);
    (comet.mesh.material as THREE.Material).dispose();
    comet.trail.geometry.dispose();
    (comet.trail.material as THREE.Material).dispose();
    if (comet.label) {
      this.cometGroup.remove(comet.label);
      disposeCommitLabel(comet.label);
    }
  }

  enqueueComet(
    sourceId: string,
    targetId: string,
    color: string,
    commitMessage?: string,
  ): void {
    this.cometQueue.push({ sourceId, targetId, color, commitMessage });
    this.processCometQueue();
  }

  private isSpawnDeferred(state: NodeState): boolean {
    return state.spawnStartTime === SPAWN_DEFERRED;
  }

  private isNodeSpawning(state: NodeState, durationMs: number, now: number): boolean {
    if (state.spawnStartTime <= 0) return false;
    return (now - state.spawnStartTime) / durationMs < 1;
  }

  private beginNodeSpawn(state: NodeState): void {
    state.spawnStartTime = performance.now();
    state.visual.scale.setScalar(0);
    if (state.node.kind !== 'event') {
      state.label.visible = true;
      (state.label.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  private revealEventNode(state: NodeState): void {
    this.beginEventSpawn(state);
  }

  private beginEventSpawn(state: NodeState): void {
    state.spawnStartTime = performance.now();
    state.visual.scale.setScalar(0);
    if (state.eventMaterials) {
      state.eventMaterials.glow.opacity = 0.85;
    }
    if (state.node.label) {
      state.label.visible = true;
      (state.label.material as THREE.SpriteMaterial).opacity = 0;
    }
    this.createSpawnBurstRing(state);
  }

  private createSpawnBurstRing(state: NodeState): void {
    this.disposeSpawnBurstRing(state);
    const color = new THREE.Color(state.node.color ?? '#8b949e');
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.actorRingGeo, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(state.baseRadius * 0.25);
    state.anchor.add(mesh);
    state.spawnBurstRing = { mesh, material };
  }

  private disposeSpawnBurstRing(state: NodeState): void {
    if (!state.spawnBurstRing) return;
    state.anchor.remove(state.spawnBurstRing.mesh);
    state.spawnBurstRing.material.dispose();
    state.spawnBurstRing = undefined;
  }

  private processCometQueue(): void {
    if (this.cometQueue.length === 0) return;

    const now = performance.now();
    let writeIndex = 0;

    for (let i = 0; i < this.cometQueue.length; i++) {
      const next = this.cometQueue[i];
      const source = this.nodeStates.get(next.sourceId);
      const target = this.nodeStates.get(next.targetId);
      if (!source || !target) {
        this.cometQueue[writeIndex++] = next;
        continue;
      }

      if (this.isSpawnDeferred(source)) {
        this.beginNodeSpawn(source);
        this.cometQueue[writeIndex++] = next;
        continue;
      }
      if (this.isNodeSpawning(source, ACTOR_SPAWN_MS, now)) {
        this.cometQueue[writeIndex++] = next;
        continue;
      }

      const repoId = target.node.parentRepoId;
      const repo = repoId ? this.nodeStates.get(repoId) : undefined;
      if (repo) {
        if (this.isSpawnDeferred(repo)) {
          this.beginNodeSpawn(repo);
          this.cometQueue[writeIndex++] = next;
          continue;
        }
        if (this.isNodeSpawning(repo, REPO_SPAWN_MS, now)) {
          this.cometQueue[writeIndex++] = next;
          continue;
        }
      }

      if (
        !this.launchComet(next.sourceId, next.targetId, next.color, next.commitMessage)
      ) {
        this.cometQueue[writeIndex++] = next;
        continue;
      }
    }

    this.cometQueue.length = writeIndex;
  }

  private launchComet(
    sourceId: string,
    targetId: string,
    color: string,
    commitMessage?: string,
  ): boolean {
    if (this.comets.length >= MAX_ACTIVE_COMETS) return false;

    const source = this.nodeStates.get(sourceId);
    const target = this.nodeStates.get(targetId);
    if (!source || !target) return false;

    const from = source.position.clone();
    const to = target.position.clone();
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y += from.distanceTo(to) * 0.08;
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

    let label: THREE.Sprite | undefined;
    if (commitMessage) {
      label = createCommitLabelSprite(commitMessage, color);
      label.position.copy(from);
      label.position.y += 2.4;
      this.cometGroup.add(label);
    }

    this.comets.push({
      mesh,
      trail,
      trailPositions,
      trailHead: 0,
      targetId,
      from,
      to,
      mid,
      color: cometColor,
      startTime: performance.now(),
      label,
    });

    const impactUntil = performance.now() + COMET_IMPACT_PULSE_MS;
    if (source.node.kind === 'actor') {
      source.tintUntil = impactUntil;
      source.tintColor = cometColor.clone();
    } else {
      source.pulseUntil = impactUntil;
    }
    target.pulseUntil = impactUntil;
    return true;
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

  resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height, false);
  }

  private updateComets(now: number): void {
    let writeIndex = 0;

    for (let i = 0; i < this.comets.length; i++) {
      const comet = this.comets[i];
      const elapsed = now - comet.startTime;
      const t = Math.min(elapsed / COMET_DURATION_MS, 1);
      const eased = t * t;

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

      if (comet.label) {
        comet.label.position.copy(pos);
        comet.label.position.y += 2.4;
        const labelMaterial = comet.label.material as THREE.SpriteMaterial;
        labelMaterial.opacity = 1 - t * 0.9;
      }

      if (t < 1) {
        this.comets[writeIndex++] = comet;
      } else {
        const target = this.nodeStates.get(comet.targetId);
        if (target?.node.kind === 'event' && this.isSpawnDeferred(target)) {
          this.revealEventNode(target);
        }
        this.disposeComet(comet);
      }
    }

    this.comets.length = writeIndex;
  }

  private updateLinkPositions(): void {
    for (const [key, line] of this.linkLines) {
      const arrowIdx = key.indexOf('->');
      if (arrowIdx < 0) continue;
      const sourceId = key.slice(0, arrowIdx);
      const targetId = key.slice(arrowIdx + 2);
      const source = this.nodeStates.get(sourceId);
      const target = this.nodeStates.get(targetId);
      if (!source || !target) continue;
      updateLinkEndpoints(line, source.position, target.position);

      const baseOpacity = this.linkBaseOpacity.get(key) ?? 0;
      const visible = !this.isSpawnDeferred(source) && !this.isSpawnDeferred(target);
      (line.material as THREE.LineBasicMaterial).opacity = visible ? baseOpacity : 0;
    }
  }

  private updateNodes(now: number): void {
    const time = this.clock.getElapsedTime();

    for (const state of this.nodeStates.values()) {
      const isPulsing = now < state.pulseUntil;
      const isActor = state.node.kind === 'actor';
      const isRepo = state.node.kind === 'repo';
      const isEvent = state.node.kind === 'event';

      if (isEvent && state.node.parentRepoId) {
        const parentPos = this.positions.get(state.node.parentRepoId);
        if (parentPos) {
          const offset = eventOrbitOffset(state.node.id, time);
          state.anchor.position.copy(parentPos).add(offset);
          state.position.copy(state.anchor.position);
        }
      }

      let scaleMul = 1;
      const isEventSpawning =
        isEvent && state.spawnStartTime > 0 && this.isNodeSpawning(state, EVENT_SPAWN_MS, now);

      if (this.isSpawnDeferred(state)) {
        state.visual.scale.setScalar(0);
      } else if ((isActor || isRepo || isEvent) && state.spawnStartTime > 0) {
        const spawnDuration = isActor
          ? ACTOR_SPAWN_MS
          : isRepo
            ? REPO_SPAWN_MS
            : EVENT_SPAWN_MS;
        const spawnT = Math.min((now - state.spawnStartTime) / spawnDuration, 1);
        scaleMul = isEvent ? easeOutBack(spawnT) : 1 - (1 - spawnT) ** 3;

        if (isEvent && state.eventMaterials) {
          state.eventMaterials.glow.opacity = THREE.MathUtils.lerp(
            0.85,
            0.32,
            Math.min(spawnT * 1.15, 1),
          );
        }

        if (state.spawnBurstRing) {
          const ringScale = state.baseRadius * (0.25 + spawnT * 6.5);
          state.spawnBurstRing.mesh.scale.setScalar(ringScale);
          state.spawnBurstRing.material.opacity = 0.9 * (1 - spawnT ** 0.85);
          if (spawnT >= 1) {
            this.disposeSpawnBurstRing(state);
          }
        }

        if (isActor || isRepo) {
          (state.label.material as THREE.SpriteMaterial).opacity = scaleMul;
        } else if (isEvent && state.node.label) {
          const labelT = Math.max(0, (spawnT - 0.4) / 0.6);
          (state.label.material as THREE.SpriteMaterial).opacity = labelT;
        }

        if (spawnT >= 1) {
          state.spawnStartTime = 0;
          if (isEvent && state.eventMaterials) {
            state.eventMaterials.glow.opacity = 0.32;
          }
        }
      }

      if (!this.isSpawnDeferred(state)) {
        const repoIdle = isRepo && state.spawnStartTime <= 0;
        const actorPulsing = isPulsing && !isActor;
        if (actorPulsing || (isEvent && !isEventSpawning) || scaleMul < 1 || repoIdle) {
          const pulse = actorPulsing ? 1 + Math.sin(now * 0.035) * 0.2 : 1;
          const breathe = repoIdle ? 1 + Math.sin(time * 1.2 + state.position.x) * 0.03 : 1;
          const eventPulse =
            isEvent && !isEventSpawning
              ? 1 + Math.sin(time * 2.4 + state.position.z) * 0.06
              : 1;
          state.visual.scale.setScalar(scaleMul * pulse * breathe * eventPulse);
        } else if (state.visual.scale.x !== 1) {
          state.visual.scale.setScalar(1);
        }
      }

      if (isActor) {
        this.applyActorTint(state, now);
      }

      if (isRepo) {
        state.visual.rotation.y = time * 0.4;
        state.visual.rotation.x = Math.sin(time * 0.3) * 0.2;
      } else if (isEvent) {
        const spinRate = isEventSpawning ? 5.5 : 1.2;
        state.visual.rotation.y = time * spinRate;
        state.visual.rotation.x = time * (isEventSpawning ? 2.4 : 0.8);
      } else if (state.ringMesh) {
        state.ringMesh.rotation.z = time * 0.5;
      }
    }

    this.updateLinkPositions();

    this.starfield.rotation.y = time * 0.008;
    this.nebula.rotation.y = -time * 0.003;
  }

  private animate = (): void => {
    if (!this.isVisible) return;

    const now = performance.now();

    this.controls.update();
    this.updateComets(now);
    this.updateNodes(now);
    this.processCometQueue();

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
    this.linkBaseOpacity.clear();

    for (const comet of this.comets) {
      this.disposeComet(comet);
    }
    this.comets.length = 0;
    this.cometQueue.length = 0;

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
    this.eventCoreGeo.dispose();
    this.eventGlowGeo.dispose();
    this.cometGeo.dispose();

    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }

    disposeLabelTextures();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
