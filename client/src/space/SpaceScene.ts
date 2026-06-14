import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BackgroundLayer } from './layers/BackgroundLayer';
import { EventFlightLayer } from './layers/EventFlightLayer';
import { EventParticleLayer } from './layers/EventParticleLayer';
import { GraphNodeLayer } from './layers/GraphNodeLayer';
import { LinkLayer } from './layers/LinkLayer';
import { RepoVisualFactory } from './layers/RepoVisualFactory';
import type { GraphData } from './utils/graphBuilder';
import { disposeLabelTextures } from './utils/labelSprite';
import { pointsAttenuationScale } from './utils/sizedPointMaterial';
import { softCircleSprite } from './utils/softSprite';
import type { EventFlightPayload } from './utils/types';

export type { EventFlightPayload } from './utils/types';

export class SpaceScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private isVisible = true;
  private autoRotateListeners = new Set<(enabled: boolean) => void>();
  private labelVisibilityListeners = new Set<(visible: boolean) => void>();

  private pointSprite = softCircleSprite();
  private repoFactory = new RepoVisualFactory();
  private eventParticles: EventParticleLayer;
  private background: BackgroundLayer;
  private nodes: GraphNodeLayer;
  private links: LinkLayer;
  private flights: EventFlightLayer;

  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible) {
      this.clock.getDelta();
      this.renderer.setAnimationLoop(this.animate);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.eventParticles = new EventParticleLayer(this.pointSprite, this.repoFactory.burstRingGeo);

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

    this.background = new BackgroundLayer(this.pointSprite);
    this.background.addTo(this.scene);

    this.nodes = new GraphNodeLayer(this.scene, this.eventParticles, this.repoFactory, this.clock);
    this.links = new LinkLayer(this.nodes);
    this.nodes.setLinkVisibilityHandler(() => this.links.applyVisibility());

    this.flights = new EventFlightLayer(this.nodes, this.eventParticles, this.pointSprite);

    this.scene.add(this.links.group);
    this.scene.add(this.eventParticles.group);
    this.scene.add(this.flights.group);

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(this.animate);
  }

  updateGraph(data: GraphData): void {
    const links = this.nodes.updateGraph(data, () => this.flights.clear());
    this.links.syncLinks(links);
  }

  enqueueEventFlight(payload: EventFlightPayload): void {
    this.flights.enqueue(payload);
  }

  setActiveEventTypes(types: Set<string>): void {
    this.nodes.setActiveEventTypes(types);
  }

  syncEventTypeFilterVisibility(): void {
    this.nodes.syncEventTypeFilterVisibility();
  }

  instantRevealEvent(eventId: string): void {
    this.nodes.instantRevealEvent(eventId);
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
    return this.nodes.getLabelsVisible();
  }

  setLabelsVisible(visible: boolean): void {
    if (this.nodes.getLabelsVisible() === visible) return;
    this.nodes.setLabelsVisible(visible);
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

  private animate = (): void => {
    if (!this.isVisible) return;

    const now = performance.now();
    const time = this.clock.getElapsedTime();

    this.controls.update();
    this.eventParticles.advancePositions(time);
    this.flights.update(now);
    this.nodes.update(now, pointsAttenuationScale(this.renderer));
    this.links.updatePositions();
    this.flights.processQueue();
    this.background.update(time);

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();

    this.flights.dispose();
    this.nodes.dispose();
    this.links.dispose();
    this.background.dispose();
    this.repoFactory.disposeSharedGeometries();
    this.eventParticles.dispose();
    disposeLabelTextures();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
