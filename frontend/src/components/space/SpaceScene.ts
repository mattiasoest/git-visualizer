import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { GraphData, GraphLink, GraphNode } from './graphBuilder';
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
  label: CSS2DObject;
  position: THREE.Vector3;
  pulseUntil: number;
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
    const direction = hashToUnitVector(repo.id).normalize();
    const radius = REPO_ORBIT_BASE + Math.min(repo.eventCount, 8) * REPO_ORBIT_SPREAD;
    positions.set(repo.id, direction.multiplyScalar(radius));
  }

  for (const actor of actors) {
    const connections = actorToRepos.get(actor.id);
    if (!connections || connections.length === 0) {
      positions.set(actor.id, hashToUnitVector(actor.id).normalize().multiplyScalar(22));
      continue;
    }

    const anchor = new THREE.Vector3();
    let totalWeight = 0;
    for (const { repoId, weight } of connections) {
      const repoPos = positions.get(repoId);
      if (!repoPos) continue;
      anchor.add(repoPos.clone().multiplyScalar(weight));
      totalWeight += weight;
    }
    if (totalWeight === 0) continue;
    anchor.divideScalar(totalWeight);

    const hash = hashToUnitVector(actor.id);
    const angle = (hash.x + 1) * Math.PI;
    const dist = ACTOR_CLUSTER_RADIUS * (0.55 + (hash.y + 1) * 0.22);

    const normal = anchor.clone().normalize();
    const up = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent1 = new THREE.Vector3().crossVectors(normal, up).normalize();
    const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1);

    positions.set(
      actor.id,
      anchor
        .clone()
        .add(tangent1.clone().multiplyScalar(Math.cos(angle) * dist))
        .add(tangent2.clone().multiplyScalar(Math.sin(angle) * dist))
        .add(normal.clone().multiplyScalar(-dist * 0.25)),
    );
  }

  return positions;
}

export class SpaceScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
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

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(clientWidth, clientHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

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

  private createLabel(text: string, kind: 'actor' | 'repo'): CSS2DObject {
    const element = document.createElement('div');
    element.className = `space-label space-label--${kind}`;
    element.textContent = text;
    return new CSS2DObject(element);
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

  private createActorMesh(node: GraphNode): THREE.Group {
    const group = new THREE.Group();
    const radius = ACTOR_BASE_RADIUS + Math.min(node.eventCount, 8) * 0.12;

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

    return group;
  }

  private createRepoMesh(node: GraphNode): THREE.Group {
    const group = new THREE.Group();
    const scale = REPO_BASE_RADIUS + Math.min(node.eventCount, 10) * 0.1;

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

    return group;
  }

  private removeNodeState(state: NodeState): void {
    state.label.element.remove();
    this.scene.remove(state.anchor);
  }

  private upsertNode(node: GraphNode, position: THREE.Vector3): NodeState {
    const existing = this.nodeStates.get(node.id);

    if (existing) {
      existing.node = node;
      existing.position.copy(position);
      existing.anchor.position.copy(position);
      existing.label.element.textContent = node.label;
      return existing;
    }

    const anchor = new THREE.Group();
    anchor.position.copy(position);
    this.scene.add(anchor);

    const visual = node.kind === 'actor' ? this.createActorMesh(node) : this.createRepoMesh(node);
    anchor.add(visual);

    const label = this.createLabel(node.label, node.kind);
    label.position.set(0, node.kind === 'actor' ? 4 : 3.2, 0);
    anchor.add(label);

    const state: NodeState = { node, anchor, visual, label, position, pulseUntil: 0 };
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
        existing.geometry.setFromPoints([source.position, target.position]);
        continue;
      }

      const geometry = new THREE.BufferGeometry().setFromPoints([
        source.position,
        target.position,
      ]);
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

  updateGraph(data: GraphData): void {
    const activeIds = new Set(data.nodes.map((n) => n.id));

    for (const [id, state] of this.nodeStates) {
      if (activeIds.has(id)) continue;
      this.removeNodeState(state);
      this.positions.delete(id);
      this.nodeStates.delete(id);
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
    this.updateLabelVisibility(data.nodes.length);
  }

  private updateLabelVisibility(nodeCount: number): void {
    const visible = nodeCount > 0;
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
    this.labelRenderer.setSize(width, height);
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
      const pulse = now < state.pulseUntil ? 1 + Math.sin(now * 0.02) * 0.15 : 1;
      const breathe = 1 + Math.sin(time * 1.2 + state.position.x) * 0.03;
      state.visual.scale.setScalar(pulse * breathe);

      if (state.node.kind === 'repo') {
        state.visual.rotation.y = time * 0.4;
        state.visual.rotation.x = Math.sin(time * 0.3) * 0.2;
      } else {
        const ring = state.visual.children[state.visual.children.length - 1];
        ring.rotation.z = time * 0.5;
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
    this.labelRenderer.render(this.scene, this.camera);
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

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
    this.container.removeChild(this.labelRenderer.domElement);
  }
}
