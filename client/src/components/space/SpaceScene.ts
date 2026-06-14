import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphData, GraphLink, GraphNode } from './graphBuilder';
import { computeHierarchicalPositions, hashToUnitVector } from './clusterLayout';
import { EVENT_SPAWN_DEFERRED, EventParticleLayer } from './EventParticleLayer';
import { eventNodeId } from './graphBuilder';
import {
  createEventLabelSprite,
  createLabelSprite,
  disposeEventLabel,
  disposeLabelTextures,
  getLabelTexture,
} from './labelSprite';
import { softCircleSprite } from './softSprite';

const USER_PARTICLE_COLOR = '#56d364';
const REPO_BASE_RADIUS = 2.0;
const REPO_ACTIVITY_MAX = 10;
const REPO_VISUAL = {
  atmosphere: 0,
  innerGlow: 1,
  outerShell: 2,
  outerWire: 3,
  innerCore: 4,
} as const;
const REPO_RING_SCALE = [2.15, 2.65] as const;
const EVENT_NODE_BASE_RADIUS = 0.75;
const FLIGHT_DURATION_MS = 550;
const FLIGHT_IMPACT_PULSE_MS = 350;
const REPO_SPAWN_MS = 900;
const EVENT_SPAWN_MS = 1600;
const SPAWN_DEFERRED = -1;
const MAX_ACTIVE_FLIGHTS = 24;
const TRAIL_POINTS = 10;
const USER_PARTICLE_SIZE = EVENT_NODE_BASE_RADIUS * 2.2 * 0.6;
const EVENT_PARTICLE_SIZE = EVENT_NODE_BASE_RADIUS * 2.2;

export interface EventFlightPayload {
  eventId: string;
  repoId: string;
  actorLogin: string;
  eventColor: string;
  eventLabel: string;
}

interface QueuedFlight extends EventFlightPayload {}

interface NodeState {
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

interface EventFlight {
  mesh: THREE.Mesh;
  trail: THREE.Points;
  trailPositions: Float32Array;
  trailHead: number;
  targetId: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  mid: THREE.Vector3;
  startColor: THREE.Color;
  endColor: THREE.Color;
  startSize: number;
  endSize: number;
  startTime: number;
  label?: THREE.Sprite;
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
  private labelVisibilityListeners = new Set<(visible: boolean) => void>();
  private activeEventTypes = new Set<string>();
  private labelsVisible = true;
  private graphHasNodes = false;
  private clock = new THREE.Clock();
  private nodeStates = new Map<string, NodeState>();
  private eventParticles: EventParticleLayer;
  private linkLines = new Map<string, THREE.Line>();
  private linkBaseOpacity = new Map<string, number>();
  private linkGroup = new THREE.Group();
  private flights: EventFlight[] = [];
  private flightQueue: QueuedFlight[] = [];
  private flightGroup = new THREE.Group();
  private starfield: THREE.Points;
  private nebula: THREE.Points;
  private positions = new Map<string, THREE.Vector3>();
  private nodeTopology = new Set<string>();
  private linkTopology = new Set<string>();
  private pointSprite = softCircleSprite();
  private isVisible = true;
  private flightPosition = new THREE.Vector3();
  private flightScratch = new THREE.Vector3();
  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible) {
      this.clock.getDelta();
      this.renderer.setAnimationLoop(this.animate);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  };

  private readonly burstRingGeo = new THREE.RingGeometry(1, 1.1, 24);
  private readonly repoOuterCrystalGeo = new THREE.IcosahedronGeometry(1, 1);
  private readonly repoInnerCoreGeo = new THREE.OctahedronGeometry(1, 0);
  private readonly repoOrbitGeo = new THREE.TorusGeometry(1, 0.028, 6, 40);
  private readonly repoOrbitGeoB = new THREE.TorusGeometry(1, 0.02, 6, 36);
  private readonly repoGlowGeo = new THREE.SphereGeometry(1, 12, 12);
  private readonly flightGeo = new THREE.SphereGeometry(0.35, 8, 8);

  private readonly repoAtmosphereMat = new THREE.MeshBasicMaterial({
    color: 0x1a6b45,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoInnerGlowMat = new THREE.MeshBasicMaterial({
    color: 0x3dd68c,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoOuterShellMat = new THREE.MeshBasicMaterial({
    color: 0x2dd4a8,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  private readonly repoOuterWireMat = new THREE.MeshBasicMaterial({
    color: 0x7dffc8,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoInnerCoreMat = new THREE.MeshBasicMaterial({
    color: 0xc8ffe8,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoOrbitMat = new THREE.MeshBasicMaterial({
    color: 0x56ffd9,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly repoOrbitMatB = new THREE.MeshBasicMaterial({
    color: 0x3fb950,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly flightMat = new THREE.MeshBasicMaterial({
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
    this.eventParticles = new EventParticleLayer(this.pointSprite, this.burstRingGeo);

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
    this.scene.add(this.eventParticles.group);
    this.scene.add(this.flightGroup);

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

  private repoRadius(eventCount: number): number {
    const clamped = Math.min(Math.max(eventCount, 1), REPO_ACTIVITY_MAX);
    return REPO_BASE_RADIUS + (clamped - 1) * (1.2 / (REPO_ACTIVITY_MAX - 1));
  }

  /** Maps repo event count to 0..1 where 1 event = 0 and 10 events = 1. */
  private repoActivityT(eventCount: number): number {
    const clamped = Math.min(Math.max(eventCount, 1), REPO_ACTIVITY_MAX);
    return (clamped - 1) / (REPO_ACTIVITY_MAX - 1);
  }

  private repoLayerColor(
    hue: number,
    saturation: number,
    lightnessAtOne: number,
    lightnessAtMax: number,
    t: number,
  ): THREE.Color {
    return new THREE.Color().setHSL(hue, saturation, lightnessAtOne + (lightnessAtMax - lightnessAtOne) * t);
  }

  private repoActivityColors(
    eventCount: number,
    repoId: string,
  ): {
    atmosphere: THREE.Color;
    innerGlow: THREE.Color;
    outerShell: THREE.Color;
    outerWire: THREE.Color;
    innerCore: THREE.Color;
    ringA: THREE.Color;
    ringB: THREE.Color;
  } {
    const t = this.repoActivityT(eventCount);
    const hueShift = hashToUnitVector(repoId).x * 0.07;
    const shellHue = 0.44 + hueShift;
    const coreHue = 0.48 + hueShift;

    return {
      atmosphere: this.repoLayerColor(shellHue, 0.55, 0.18, 0.07, t),
      innerGlow: this.repoLayerColor(coreHue, 0.75, 0.42, 0.16, t),
      outerShell: this.repoLayerColor(shellHue, 0.7, 0.38, 0.13, t),
      outerWire: this.repoLayerColor(coreHue, 0.85, 0.62, 0.24, t),
      innerCore: this.repoLayerColor(coreHue + 0.02, 0.9, 0.78, 0.2, t),
      ringA: this.repoLayerColor(coreHue + 0.04, 0.9, 0.58, 0.18, t),
      ringB: this.repoLayerColor(shellHue + 0.03, 0.65, 0.45, 0.11, t),
    };
  }

  private repoMaterialOpacities(): {
    atmosphere: number;
    innerGlow: number;
    outerShell: number;
    outerWire: number;
    innerCore: number;
    ringA: number;
    ringB: number;
  } {
    return {
      atmosphere: 0.08,
      innerGlow: 0.18,
      outerShell: 0.32,
      outerWire: 0.45,
      innerCore: 0.88,
      ringA: 0.5,
      ringB: 0.28,
    };
  }

  private repoOrbitRingCount(eventCount: number): number {
    if (eventCount < 3) return 0;
    if (eventCount < 6) return 1;
    return 2;
  }

  private clearRepoOrbitRings(state: NodeState): void {
    if (state.repoOrbitRings) {
      for (const ring of state.repoOrbitRings) {
        state.visual.remove(ring);
      }
    }
    if (state.repoRingMaterials) {
      for (const mat of state.repoRingMaterials) {
        mat.dispose();
      }
    }
    state.repoOrbitRings = undefined;
    state.repoRingMaterials = undefined;
    state.repoRingTier = undefined;
  }

  private syncRepoOrbitRings(state: NodeState, eventCount: number): void {
    const tier = this.repoOrbitRingCount(eventCount);
    if (state.repoRingTier === tier) return;

    this.clearRepoOrbitRings(state);
    state.repoRingTier = tier;
    if (tier === 0) return;

    const scale = this.repoRadius(eventCount);
    const colors = this.repoActivityColors(eventCount, state.node.id);
    const opacities = this.repoMaterialOpacities();
    const rings: THREE.Mesh[] = [];
    const materials: THREE.MeshBasicMaterial[] = [];

    if (tier >= 1) {
      const ringAMat = this.repoOrbitMat.clone();
      ringAMat.color.copy(colors.ringA);
      ringAMat.opacity = opacities.ringA;
      const ringA = new THREE.Mesh(this.repoOrbitGeo, ringAMat);
      ringA.scale.setScalar(scale * REPO_RING_SCALE[0]);
      ringA.rotation.x = Math.PI / 3;
      ringA.rotation.y = 0.45;
      state.visual.add(ringA);
      rings.push(ringA);
      materials.push(ringAMat);
    }

    if (tier >= 2) {
      const ringBMat = this.repoOrbitMatB.clone();
      ringBMat.color.copy(colors.ringB);
      ringBMat.opacity = opacities.ringB;
      const ringB = new THREE.Mesh(this.repoOrbitGeoB, ringBMat);
      ringB.scale.setScalar(scale * REPO_RING_SCALE[1]);
      ringB.rotation.x = Math.PI / 2.15;
      ringB.rotation.z = 0.75;
      state.visual.add(ringB);
      rings.push(ringB);
      materials.push(ringBMat);
    }

    state.repoOrbitRings = rings;
    state.repoRingMaterials = materials;
  }

  private applyRepoColors(state: NodeState, eventCount: number): void {
    if (!state.repoMaterials) return;

    const colors = this.repoActivityColors(eventCount, state.node.id);
    state.repoMaterials.atmosphere.color.copy(colors.atmosphere);
    state.repoMaterials.innerGlow.color.copy(colors.innerGlow);
    state.repoMaterials.outerShell.color.copy(colors.outerShell);
    state.repoMaterials.outerWire.color.copy(colors.outerWire);
    state.repoMaterials.innerCore.color.copy(colors.innerCore);

    const opacities = this.repoMaterialOpacities();
    state.repoMaterials.atmosphere.opacity = opacities.atmosphere;
    state.repoMaterials.innerGlow.opacity = opacities.innerGlow;
    state.repoMaterials.outerShell.opacity = opacities.outerShell;
    state.repoMaterials.outerWire.opacity = opacities.outerWire;
    state.repoMaterials.innerCore.opacity = opacities.innerCore;

    if (state.repoRingMaterials?.[0]) {
      state.repoRingMaterials[0].color.copy(colors.ringA);
      state.repoRingMaterials[0].opacity = opacities.ringA;
    }
    if (state.repoRingMaterials?.[1]) {
      state.repoRingMaterials[1].color.copy(colors.ringB);
      state.repoRingMaterials[1].opacity = opacities.ringB;
    }
  }

  private applyRepoScales(visual: THREE.Group, scale: number, orbitRings?: THREE.Mesh[]): void {
    visual.children[REPO_VISUAL.atmosphere].scale.setScalar(scale * 2.6);
    visual.children[REPO_VISUAL.innerGlow].scale.setScalar(scale * 1.25);
    visual.children[REPO_VISUAL.outerShell].scale.setScalar(scale);
    visual.children[REPO_VISUAL.outerWire].scale.setScalar(scale * 1.04);
    visual.children[REPO_VISUAL.innerCore].scale.setScalar(scale * 0.5);

    if (orbitRings) {
      for (let i = 0; i < orbitRings.length; i++) {
        orbitRings[i]!.scale.setScalar(scale * REPO_RING_SCALE[i]!);
      }
    }
  }

  private createRepoMesh(node: GraphNode): {
    group: THREE.Group;
    baseRadius: number;
    innerCore: THREE.Mesh;
    materials: NonNullable<NodeState['repoMaterials']>;
  } {
    const group = new THREE.Group();
    const scale = this.repoRadius(node.eventCount);
    const colors = this.repoActivityColors(node.eventCount, node.id);
    const opacities = this.repoMaterialOpacities();

    const atmosphereMat = this.repoAtmosphereMat.clone();
    atmosphereMat.color.copy(colors.atmosphere);
    atmosphereMat.opacity = opacities.atmosphere;
    const atmosphere = new THREE.Mesh(this.repoGlowGeo, atmosphereMat);
    atmosphere.scale.setScalar(scale * 2.6);
    group.add(atmosphere);

    const innerGlowMat = this.repoInnerGlowMat.clone();
    innerGlowMat.color.copy(colors.innerGlow);
    innerGlowMat.opacity = opacities.innerGlow;
    const innerGlow = new THREE.Mesh(this.repoGlowGeo, innerGlowMat);
    innerGlow.scale.setScalar(scale * 1.25);
    group.add(innerGlow);

    const outerShellMat = this.repoOuterShellMat.clone();
    outerShellMat.color.copy(colors.outerShell);
    outerShellMat.opacity = opacities.outerShell;
    const outerShell = new THREE.Mesh(this.repoOuterCrystalGeo, outerShellMat);
    outerShell.scale.setScalar(scale);
    group.add(outerShell);

    const outerWireMat = this.repoOuterWireMat.clone();
    outerWireMat.color.copy(colors.outerWire);
    outerWireMat.opacity = opacities.outerWire;
    const outerWire = new THREE.Mesh(this.repoOuterCrystalGeo, outerWireMat);
    outerWire.scale.setScalar(scale * 1.04);
    group.add(outerWire);

    const innerCoreMat = this.repoInnerCoreMat.clone();
    innerCoreMat.color.copy(colors.innerCore);
    innerCoreMat.opacity = opacities.innerCore;
    const innerCore = new THREE.Mesh(this.repoInnerCoreGeo, innerCoreMat);
    innerCore.scale.setScalar(scale * 0.5);
    group.add(innerCore);

    return {
      group,
      baseRadius: scale,
      innerCore,
      materials: {
        atmosphere: atmosphereMat,
        innerGlow: innerGlowMat,
        outerShell: outerShellMat,
        outerWire: outerWireMat,
        innerCore: innerCoreMat,
      },
    };
  }

  private disposeRepoMaterials(state: NodeState): void {
    if (!state.repoMaterials) return;
    state.repoMaterials.atmosphere.dispose();
    state.repoMaterials.innerGlow.dispose();
    state.repoMaterials.outerShell.dispose();
    state.repoMaterials.outerWire.dispose();
    state.repoMaterials.innerCore.dispose();
    state.repoMaterials = undefined;
    this.clearRepoOrbitRings(state);
    state.repoInnerCore = undefined;
  }

  private disposeNodeLabel(state: NodeState): void {
    if (state.node.kind === 'event') {
      disposeEventLabel(state.label);
      return;
    }
    (state.label.material as THREE.SpriteMaterial).dispose();
  }

  private syncEventLabel(state: NodeState, node: GraphNode): void {
    if (state.label) {
      this.disposeNodeLabel(state);
      state.anchor.remove(state.label);
    }

    if (!node.label || !node.actorLogin) {
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
      label.visible = false;
      state.anchor.add(label);
      state.label = label;
      return;
    }

    const label = createEventLabelSprite(node.actorLogin, node.label, node.color ?? '#8b949e');
    label.position.set(0, -2.2, 0);
    state.anchor.add(label);
    state.label = label;
  }

  private removeNodeState(state: NodeState): void {
    if (state.node.kind === 'repo') {
      this.disposeRepoMaterials(state);
    }
    this.disposeNodeLabel(state);
    this.scene.remove(state.anchor);
  }

  private updateLabelSprite(state: NodeState, text: string): void {
    (state.label.material as THREE.SpriteMaterial).dispose();
    state.anchor.remove(state.label);

    const label = createLabelSprite(text, 'repo');
    label.position.set(0, 2.6, 0);
    state.anchor.add(label);
    state.label = label;
  }

  private upsertNode(node: GraphNode, position: THREE.Vector3): NodeState {
    const existing = this.nodeStates.get(node.id);

    if (existing) {
      const eventCountChanged = existing.node.eventCount !== node.eventCount;
      const labelChanged =
        existing.node.label !== node.label || existing.node.actorLogin !== node.actorLogin;
      existing.node = node;
      existing.position.copy(position);
      existing.anchor.position.copy(position);

      if (eventCountChanged && node.kind === 'repo') {
        const scale = this.repoRadius(node.eventCount);
        existing.baseRadius = scale;
        this.syncRepoOrbitRings(existing, node.eventCount);
        this.applyRepoScales(existing.visual, scale, existing.repoOrbitRings);
        this.applyRepoColors(existing, node.eventCount);
      }

      if (labelChanged && node.kind === 'repo') {
        this.updateLabelSprite(existing, node.label);
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
    let repoMaterials: NodeState['repoMaterials'];
    let repoInnerCore: NodeState['repoInnerCore'];

    if (node.kind === 'repo') {
      const repoMesh = this.createRepoMesh(node);
      visual = repoMesh.group;
      baseRadius = repoMesh.baseRadius;
      repoMaterials = repoMesh.materials;
      repoInnerCore = repoMesh.innerCore;
    } else {
      visual = new THREE.Group();
      baseRadius = EVENT_NODE_BASE_RADIUS;
    }

    anchor.add(visual);

    if (node.kind === 'repo' || node.kind === 'event') {
      visual.scale.setScalar(0);
    }

    let label: THREE.Sprite;
    if (node.kind === 'event') {
      label =
        node.label && node.actorLogin
          ? createEventLabelSprite(node.actorLogin, node.label, node.color ?? '#8b949e')
          : new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
      if (node.label && node.actorLogin) {
        label.position.set(0, -2.2, 0);
      }
      label.visible = false;
    } else {
      label = createLabelSprite(node.label, 'repo');
      label.position.set(0, 2.6, 0);
    }
    anchor.add(label);

    if (node.kind === 'repo') {
      (label.material as THREE.SpriteMaterial).opacity = 0;
    }

    const spawnStartTime = node.kind === 'repo' || node.kind === 'event' ? SPAWN_DEFERRED : 0;

    const state: NodeState = {
      node,
      anchor,
      visual,
      label,
      position,
      pulseUntil: 0,
      repoMaterials,
      repoInnerCore,
      spawnStartTime,
      baseRadius,
    };
    if (node.kind === 'repo') {
      this.syncRepoOrbitRings(state, node.eventCount);
    }
    this.nodeStates.set(node.id, state);
    return state;
  }

  private syncEventParticles(eventNodes: GraphNode[]): void {
    const particles = eventNodes.map((node) => {
      const state = this.nodeStates.get(node.id);
      return {
        id: node.id,
        parentRepoId: node.parentRepoId!,
        color: node.color ?? '#8b949e',
        spawnStartTime: state?.spawnStartTime ?? EVENT_SPAWN_DEFERRED,
        pulseUntil: state?.pulseUntil ?? 0,
      };
    });

    const parentPositions = new Map<string, THREE.Vector3>();
    for (const [id, pos] of this.positions) {
      if (id.startsWith('repo:')) parentPositions.set(id, pos);
    }

    this.eventParticles.sync(particles, parentPositions);
  }

  private getNodePosition(id: string): THREE.Vector3 | undefined {
    if (id.startsWith('event:')) {
      return this.eventParticles.getPosition(id);
    }
    return this.nodeStates.get(id)?.position;
  }

  private isEndpointSpawnDeferred(id: string): boolean {
    if (id.startsWith('event:')) {
      return this.eventParticles.isSpawnDeferred(id);
    }
    const state = this.nodeStates.get(id);
    return state ? this.isSpawnDeferred(state) : true;
  }

  private getLinkPosition(id: string): THREE.Vector3 | undefined {
    if (id.startsWith('event:')) {
      return this.getNodePosition(id);
    }
    return this.nodeStates.get(id)?.position;
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
      const sourcePos = this.getLinkPosition(link.sourceId);
      const targetPos = this.getLinkPosition(link.targetId);
      if (!sourcePos || !targetPos) continue;

      const baseOpacity = 0.22 + Math.min(link.weight, 4) * 0.03;
      this.linkBaseOpacity.set(link.key, baseOpacity);
      const visible =
        !this.isEndpointSpawnDeferred(link.sourceId) &&
        this.isEventEndpointVisible(link.sourceId);
      const existing = this.linkLines.get(link.key);
      if (existing) {
        (existing.material as THREE.LineBasicMaterial).opacity = visible ? baseOpacity : 0;
        updateLinkEndpoints(existing, sourcePos, targetPos);
        continue;
      }

      const geometry = createLinkGeometry(sourcePos, targetPos);
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
      this.clearFlights();
    }

    this.positions = computeHierarchicalPositions(data.nodes, data.links);

    for (const node of data.nodes) {
      const position = this.positions.get(node.id);
      if (!position) continue;
      this.upsertNode(node, position);
    }

    this.syncLinks(data.links);
    this.syncEventParticles(data.nodes.filter((n) => n.kind === 'event'));
    this.graphHasNodes = data.nodes.length > 0;
    this.applyNodeLabelVisibility();

    this.nodeTopology = activeIds;
    this.linkTopology = linkKeys;
  }

  private nodeLabelShouldShow(state: NodeState): boolean {
    if (!this.labelsVisible || !this.graphHasNodes) return false;
    if (!state.anchor.visible) return false;
    if (this.isSpawnDeferred(state)) return false;
    if (state.node.kind === 'event') {
      return Boolean(state.node.label && state.node.actorLogin);
    }
    return true;
  }

  private applyNodeLabelVisibility(): void {
    for (const state of this.nodeStates.values()) {
      const shouldShow = this.nodeLabelShouldShow(state);
      const material = state.label.material as THREE.SpriteMaterial;
      state.label.visible = shouldShow;
      if (shouldShow && state.spawnStartTime <= 0) {
        material.opacity = 1;
      }
    }
  }

  private syncIdleNodeLabel(state: NodeState): void {
    if (this.isSpawnDeferred(state) || state.spawnStartTime > 0) return;

    const material = state.label.material as THREE.SpriteMaterial;
    if (this.labelsVisible && this.graphHasNodes) {
      const shouldShow =
        state.node.kind === 'event'
          ? Boolean(state.node.label && state.node.actorLogin)
          : true;
      state.label.visible = shouldShow;
      if (shouldShow) {
        material.opacity = 1;
      }
    } else {
      state.label.visible = false;
    }
  }

  private clearFlights(): void {
    for (const flight of this.flights) {
      this.disposeFlight(flight);
    }
    this.flights.length = 0;
    this.flightQueue.length = 0;
  }

  private disposeFlight(flight: EventFlight): void {
    this.flightGroup.remove(flight.mesh);
    this.flightGroup.remove(flight.trail);
    (flight.mesh.material as THREE.Material).dispose();
    flight.trail.geometry.dispose();
    (flight.trail.material as THREE.Material).dispose();
    if (flight.label) {
      this.flightGroup.remove(flight.label);
      (flight.label.material as THREE.SpriteMaterial).dispose();
    }
  }

  private createActorFlightLabel(actorLogin: string): THREE.Sprite {
    const texture = getLabelTexture(actorLogin, 'repo');
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    const aspect = texture.image.width / texture.image.height;
    const height = 0.85;
    sprite.scale.set(height * aspect, height, 1);
    return sprite;
  }

  enqueueEventFlight(payload: EventFlightPayload): void {
    this.flightQueue.push({ ...payload });
    this.processFlightQueue();
  }

  setActiveEventTypes(types: Set<string>): void {
    this.activeEventTypes = types;
    this.applyEventTypeVisibility(true);
  }

  syncEventTypeFilterVisibility(): void {
    this.applyEventTypeVisibility(false);
  }

  instantRevealEvent(eventId: string): void {
    const targetId = eventNodeId(eventId);
    const target = this.nodeStates.get(targetId);
    if (!target || target.node.kind !== 'event') return;

    const repoId = target.node.parentRepoId;
    if (repoId) {
      const repo = this.nodeStates.get(repoId);
      if (repo) this.completeNodeSpawn(repo);
    }

    this.completeNodeSpawn(target);
    this.eventParticles.completeSpawn(target.node.id);
    this.syncIdleNodeLabel(target);
  }

  private isEventTypeActive(node: GraphNode): boolean {
    if (node.kind !== 'event') return true;
    return node.eventType ? this.activeEventTypes.has(node.eventType) : true;
  }

  private repoHasVisibleEvents(repoId: string): boolean {
    for (const state of this.nodeStates.values()) {
      if (
        state.node.kind === 'event' &&
        state.node.parentRepoId === repoId &&
        this.isEventTypeActive(state.node)
      ) {
        return true;
      }
    }
    return false;
  }

  private completeNodeSpawn(state: NodeState): void {
    if (this.isSpawnDeferred(state)) {
      state.spawnStartTime = 0;
      state.visual.scale.setScalar(1);
      if (state.node.kind !== 'event' && this.labelsVisible) {
        state.label.visible = true;
        (state.label.material as THREE.SpriteMaterial).opacity = 1;
      }
    } else if (state.spawnStartTime > 0) {
      state.spawnStartTime = 0;
      state.visual.scale.setScalar(1);
    }
  }

  private applyEventTypeVisibility(instantOnShow: boolean): void {
    const hiddenParticleIds = new Set<string>();

    for (const state of this.nodeStates.values()) {
      if (state.node.kind !== 'event') continue;

      const visible = this.isEventTypeActive(state.node);
      if (visible) {
        if (instantOnShow) {
          this.completeNodeSpawn(state);
          this.eventParticles.completeSpawn(state.node.id);
        }
        state.anchor.visible = true;
        if (instantOnShow) {
          this.syncIdleNodeLabel(state);
        }
      } else {
        state.anchor.visible = false;
        state.label.visible = false;
        hiddenParticleIds.add(state.node.id);
      }
    }

    for (const state of this.nodeStates.values()) {
      if (state.node.kind !== 'repo') continue;
      const visible = this.repoHasVisibleEvents(state.node.id);
      if (visible) {
        if (instantOnShow) {
          this.completeNodeSpawn(state);
        }
        state.anchor.visible = true;
        if (instantOnShow) {
          this.syncIdleNodeLabel(state);
        }
      } else {
        state.anchor.visible = false;
        state.label.visible = false;
      }
    }

    this.eventParticles.setHidden(hiddenParticleIds);
    this.applyLinkVisibility();
  }

  private applyLinkVisibility(): void {
    for (const [key, line] of this.linkLines) {
      const arrowIdx = key.indexOf('->');
      if (arrowIdx < 0) continue;
      const sourceId = key.slice(0, arrowIdx);
      const baseOpacity = this.linkBaseOpacity.get(key) ?? 0;
      const typeVisible =
        !sourceId.startsWith('event:') || this.isEventEndpointVisible(sourceId);
      const spawnVisible = !this.isEndpointSpawnDeferred(sourceId);
      (line.material as THREE.LineBasicMaterial).opacity =
        typeVisible && spawnVisible ? baseOpacity : 0;
    }
  }

  private isEventEndpointVisible(id: string): boolean {
    if (!id.startsWith('event:')) return true;
    const state = this.nodeStates.get(id);
    return state ? state.anchor.visible : false;
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
      state.label.visible = this.labelsVisible;
      (state.label.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  private revealEventNode(state: NodeState): void {
    this.beginEventSpawn(state);
  }

  private beginEventSpawn(state: NodeState): void {
    state.spawnStartTime = performance.now();
    this.eventParticles.beginSpawn(state.node.id);
    if (state.node.label && state.node.actorLogin) {
      state.label.visible = this.labelsVisible;
      (state.label.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  private processFlightQueue(): void {
    if (this.flightQueue.length === 0) return;

    const now = performance.now();
    let writeIndex = 0;

    for (let i = 0; i < this.flightQueue.length; i++) {
      const next = this.flightQueue[i]!;
      const targetId = eventNodeId(next.eventId);
      const target = this.nodeStates.get(targetId);
      const repo = this.nodeStates.get(next.repoId);

      if (!target || !repo) {
        this.flightQueue[writeIndex++] = next;
        continue;
      }

      if (this.isSpawnDeferred(repo)) {
        this.beginNodeSpawn(repo);
      }

      if (this.isNodeSpawning(repo, REPO_SPAWN_MS, now)) {
        this.flightQueue[writeIndex++] = next;
        continue;
      }

      if (!this.launchEventFlight(next)) {
        this.flightQueue[writeIndex++] = next;
        continue;
      }
    }

    this.flightQueue.length = writeIndex;
  }

  private launchEventFlight(payload: QueuedFlight): boolean {
    if (this.flights.length >= MAX_ACTIVE_FLIGHTS) return false;

    const targetId = eventNodeId(payload.eventId);
    const repo = this.nodeStates.get(payload.repoId);
    const targetPos = this.getNodePosition(targetId);
    if (!repo || !targetPos) return false;

    const to = targetPos.clone();
    const repoPos = repo.position.clone();
    this.flightScratch.copy(to).sub(repoPos);
    if (this.flightScratch.lengthSq() < 0.001) {
      this.flightScratch.set(0, 1, 0);
    } else {
      this.flightScratch.normalize();
    }
    const from = repoPos.clone().addScaledVector(this.flightScratch, repo.baseRadius * 1.15);
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y += from.distanceTo(to) * 0.08;

    const startColor = new THREE.Color(USER_PARTICLE_COLOR);
    const endColor = new THREE.Color(payload.eventColor);

    const mesh = new THREE.Mesh(this.flightGeo, this.flightMat.clone());
    (mesh.material as THREE.MeshBasicMaterial).color.copy(startColor);
    mesh.scale.setScalar(USER_PARTICLE_SIZE);
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
    (trail.material as THREE.PointsMaterial).color.copy(startColor);

    this.flightGroup.add(mesh);
    this.flightGroup.add(trail);

    let label: THREE.Sprite | undefined;
    if (this.labelsVisible) {
      label = this.createActorFlightLabel(payload.actorLogin);
      label.position.copy(from);
      label.position.y += 1.6;
      this.flightGroup.add(label);
    }

    this.flights.push({
      mesh,
      trail,
      trailPositions,
      trailHead: 0,
      targetId,
      from,
      to,
      mid,
      startColor,
      endColor,
      startSize: USER_PARTICLE_SIZE,
      endSize: EVENT_PARTICLE_SIZE,
      startTime: performance.now(),
      label,
    });

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

  getLabelsVisible(): boolean {
    return this.labelsVisible;
  }

  setLabelsVisible(visible: boolean): void {
    if (this.labelsVisible === visible) return;
    this.labelsVisible = visible;
    this.applyNodeLabelVisibility();
    for (const flight of this.flights) {
      if (!flight.label) continue;
      flight.label.visible = visible;
      if (visible) {
        (flight.label.material as THREE.SpriteMaterial).opacity = 1;
      }
    }
    for (const listener of this.labelVisibilityListeners) {
      listener(visible);
    }
  }

  onLabelsVisibleChange(listener: (visible: boolean) => void): () => void {
    this.labelVisibilityListeners.add(listener);
    return () => {
      this.labelVisibilityListeners.delete(listener);
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

  private updateFlights(now: number): void {
    let writeIndex = 0;
    const morphColor = new THREE.Color();

    for (let i = 0; i < this.flights.length; i++) {
      const flight = this.flights[i]!;
      const elapsed = now - flight.startTime;
      const t = Math.min(elapsed / FLIGHT_DURATION_MS, 1);
      const eased = t * t;

      const oneMinusT = 1 - eased;
      const omt2 = oneMinusT * oneMinusT;
      const e2 = eased * eased;
      const pos = this.flightPosition;
      pos.x = omt2 * flight.from.x + 2 * oneMinusT * eased * flight.mid.x + e2 * flight.to.x;
      pos.y = omt2 * flight.from.y + 2 * oneMinusT * eased * flight.mid.y + e2 * flight.to.y;
      pos.z = omt2 * flight.from.z + 2 * oneMinusT * eased * flight.mid.z + e2 * flight.to.z;

      morphColor.copy(flight.startColor).lerp(flight.endColor, eased);
      const size = flight.startSize + (flight.endSize - flight.startSize) * eased;

      flight.mesh.position.copy(pos);
      flight.mesh.scale.setScalar(size);
      (flight.mesh.material as THREE.MeshBasicMaterial).color.copy(morphColor);
      (flight.trail.material as THREE.PointsMaterial).color.copy(morphColor);

      flight.trailHead = (flight.trailHead + 1) % TRAIL_POINTS;
      const idx = flight.trailHead * 3;
      flight.trailPositions[idx] = pos.x;
      flight.trailPositions[idx + 1] = pos.y;
      flight.trailPositions[idx + 2] = pos.z;
      flight.trail.geometry.attributes.position.needsUpdate = true;

      if (flight.label) {
        flight.label.position.copy(pos);
        flight.label.position.y += 1.6;
        (flight.label.material as THREE.SpriteMaterial).opacity = 1 - t * 0.9;
      }

      if (t < 1) {
        this.flights[writeIndex++] = flight;
      } else {
        const target = this.nodeStates.get(flight.targetId);
        if (target?.node.kind === 'event' && this.isSpawnDeferred(target)) {
          this.revealEventNode(target);
        }
        const impactUntil = performance.now() + FLIGHT_IMPACT_PULSE_MS;
        this.eventParticles.setPulseUntil(flight.targetId, impactUntil);
        if (target) target.pulseUntil = impactUntil;
        this.disposeFlight(flight);
      }
    }

    this.flights.length = writeIndex;
  }

  private updateLinkPositions(): void {
    for (const [key, line] of this.linkLines) {
      const arrowIdx = key.indexOf('->');
      if (arrowIdx < 0) continue;
      const sourceId = key.slice(0, arrowIdx);
      const targetId = key.slice(arrowIdx + 2);
      const sourcePos = this.getLinkPosition(sourceId);
      const targetPos = this.getLinkPosition(targetId);
      if (!sourcePos || !targetPos) continue;
      updateLinkEndpoints(line, sourcePos, targetPos);

      const baseOpacity = this.linkBaseOpacity.get(key) ?? 0;
      const visible =
        !this.isEndpointSpawnDeferred(sourceId) && this.isEventEndpointVisible(sourceId);
      (line.material as THREE.LineBasicMaterial).opacity = visible ? baseOpacity : 0;
    }
  }

  private updateNodes(now: number): void {
    const time = this.clock.getElapsedTime();
    this.eventParticles.update(time, now);

    for (const state of this.nodeStates.values()) {
      if (state.node.kind === 'event') {
        if (!state.anchor.visible) {
          state.label.visible = false;
          continue;
        }

        const pos = this.eventParticles.getPosition(state.node.id);
        if (pos) {
          state.anchor.position.copy(pos);
          state.position.copy(pos);
        }

        if (this.isSpawnDeferred(state)) {
          state.label.visible = false;
          continue;
        }

        if (state.spawnStartTime > 0 && this.isNodeSpawning(state, EVENT_SPAWN_MS, now)) {
          const spawnT = Math.min((now - state.spawnStartTime) / EVENT_SPAWN_MS, 1);
          if (state.node.label && state.node.actorLogin && this.labelsVisible) {
            state.label.visible = true;
            const labelT = Math.max(0, (spawnT - 0.4) / 0.6);
            (state.label.material as THREE.SpriteMaterial).opacity = labelT;
          } else if (!this.labelsVisible) {
            state.label.visible = false;
          }
          if (spawnT >= 1) {
            state.spawnStartTime = 0;
          }
        } else {
          this.syncIdleNodeLabel(state);
        }
        continue;
      }

      const isRepo = state.node.kind === 'repo';

      if (!state.anchor.visible) {
        state.label.visible = false;
        continue;
      }

      let scaleMul = 1;

      if (this.isSpawnDeferred(state)) {
        state.visual.scale.setScalar(0);
      } else if (state.spawnStartTime > 0) {
        const spawnT = Math.min((now - state.spawnStartTime) / REPO_SPAWN_MS, 1);
        scaleMul = 1 - (1 - spawnT) ** 3;

        if (this.labelsVisible) {
          state.label.visible = true;
          (state.label.material as THREE.SpriteMaterial).opacity = scaleMul;
        } else {
          state.label.visible = false;
        }

        if (spawnT >= 1) {
          state.spawnStartTime = 0;
        }
      } else {
        this.syncIdleNodeLabel(state);
      }

      if (!this.isSpawnDeferred(state)) {
        const repoIdle = isRepo && state.spawnStartTime <= 0;
        if (scaleMul < 1 || repoIdle) {
          const breathe = repoIdle ? 1 + Math.sin(time * 1.2 + state.position.x) * 0.03 : 1;
          state.visual.scale.setScalar(scaleMul * breathe);
        } else if (state.visual.scale.x !== 1) {
          state.visual.scale.setScalar(1);
        }
      }

      if (isRepo) {
        state.visual.rotation.y = time * 0.32;
        state.visual.rotation.x = Math.sin(time * 0.28) * 0.18;
        state.visual.rotation.z = Math.cos(time * 0.22 + state.position.z * 0.01) * 0.08;

        if (state.repoInnerCore) {
          state.repoInnerCore.rotation.y = -time * 1.1;
          state.repoInnerCore.rotation.x = time * 0.75;
        }

        if (state.repoOrbitRings?.[0]) {
          state.repoOrbitRings[0].rotation.z = time * 0.85;
        }
        if (state.repoOrbitRings?.[1]) {
          state.repoOrbitRings[1].rotation.y = -time * 0.62;
        }
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
    this.updateFlights(now);
    this.updateNodes(now);
    this.processFlightQueue();

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

    for (const flight of this.flights) {
      this.disposeFlight(flight);
    }
    this.flights.length = 0;
    this.flightQueue.length = 0;

    this.starfield.geometry.dispose();
    (this.starfield.material as THREE.Material).dispose();
    this.nebula.geometry.dispose();
    (this.nebula.material as THREE.Material).dispose();

    this.burstRingGeo.dispose();
    this.repoOuterCrystalGeo.dispose();
    this.repoInnerCoreGeo.dispose();
    this.repoOrbitGeo.dispose();
    this.repoOrbitGeoB.dispose();
    this.repoGlowGeo.dispose();
    this.flightGeo.dispose();

    this.eventParticles.dispose();

    disposeLabelTextures();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
