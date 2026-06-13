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
const LABEL_RENDER_INTERVAL = 3;

interface NodeState {
  node: GraphNode;
  mesh: THREE.Group;
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

function nodeOrbitRadius(node: GraphNode): number {
  const base = node.kind === 'actor' ? 28 : 52;
  const spread = Math.min(node.eventCount, 12) * 1.4;
  return base + spread + (hashToUnitVector(node.id).y + 1) * 8;
}

export class SpaceScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
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
  private frameCount = 0;
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
      this.controls.autoRotate = false;
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

  private getPosition(node: GraphNode): THREE.Vector3 {
    const existing = this.positions.get(node.id);
    if (existing) return existing;

    const direction = hashToUnitVector(node.id).normalize();
    const radius = nodeOrbitRadius(node);
    const position = direction.multiplyScalar(radius);
    this.positions.set(node.id, position);
    return position;
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

  private upsertNode(node: GraphNode): NodeState {
    const existing = this.nodeStates.get(node.id);
    const position = this.getPosition(node);

    if (existing) {
      existing.node = node;
      existing.position.copy(position);
      existing.mesh.position.copy(position);
      return existing;
    }

    const mesh = node.kind === 'actor' ? this.createActorMesh(node) : this.createRepoMesh(node);
    mesh.position.copy(position);
    this.scene.add(mesh);

    const label = this.createLabel(node.label, node.kind);
    label.position.set(0, node.kind === 'actor' ? 4 : 3.2, 0);
    mesh.add(label);

    const state: NodeState = { node, mesh, label, position, pulseUntil: 0 };
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
      this.scene.remove(state.mesh);
      this.positions.delete(id);
      this.nodeStates.delete(id);
    }

    for (const node of data.nodes) {
      this.upsertNode(node);
    }

    this.syncLinks(data.links);
    this.updateLabelVisibility(data.nodes.length);
  }

  private updateLabelVisibility(nodeCount: number): void {
    const showAll = nodeCount <= 35;
    for (const state of this.nodeStates.values()) {
      state.label.visible = showAll || state.node.eventCount >= 3;
    }
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
      state.mesh.scale.setScalar(pulse * breathe);

      if (state.node.kind === 'repo') {
        state.mesh.rotation.y = time * 0.4;
        state.mesh.rotation.x = Math.sin(time * 0.3) * 0.2;
      } else {
        const ring = state.mesh.children[state.mesh.children.length - 1];
        ring.rotation.z = time * 0.5;
      }
    }

    this.starfield.rotation.y = time * 0.008;
    this.nebula.rotation.y = -time * 0.003;
  }

  private animate = (): void => {
    if (!this.isVisible) return;

    const now = performance.now();
    this.frameCount += 1;

    this.controls.update();
    this.updateComets(now);
    this.updateNodes(now);

    this.renderer.render(this.scene, this.camera);

    if (this.frameCount % LABEL_RENDER_INTERVAL === 0) {
      this.labelRenderer.render(this.scene, this.camera);
    }
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();

    for (const state of this.nodeStates.values()) {
      this.scene.remove(state.mesh);
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
