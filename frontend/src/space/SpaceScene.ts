import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BackgroundLayer } from './layers/BackgroundLayer';
import { BlackholeMergeLayer } from './layers/BlackholeMergeLayer';
import { EventFlightLayer } from './layers/EventFlightLayer';
import { EventParticleLayer } from './layers/EventParticleLayer';
import { GalaxyLayer } from './layers/GalaxyLayer';
import { GraphNodeLayer } from './layers/GraphNodeLayer';
import { LinkLayer } from './layers/LinkLayer';
import { RepoVisualFactory } from './layers/RepoVisualFactory';
import type { GraphData } from './utils/graphBuilder';
import {
  ACTIVE_CLUSTER_CAMERA_DISTANCE,
  GALAXY_CAMERA_DISTANCE,
} from './utils/constants';
import {
  activeClusterWorldOffset,
  archiveWorldOffset,
} from './utils/galaxyLayout';
import { disposeLabelTextures } from './utils/labelSprite';
import { RaycastPicker } from './utils/raycastPicker';
import { pointsAttenuationScale } from './utils/sizedPointMaterial';
import { softCircleSprite } from './utils/softSprite';
import type {
  CosmosViewMode,
  EventFlightPayload,
  GalaxyArchiveRef,
} from './utils/types';

export type { CosmosViewMode, GalaxyArchiveRef } from './utils/types';

export interface CosmosLayoutInput {
  mode: CosmosViewMode;
  archives: GalaxyArchiveRef[];
  activeGraphData: GraphData;
  detailGraphData?: GraphData;
}

const OVERVIEW_CAMERA_DISTANCE_BASE = 95;
const DETAIL_CAMERA_DISTANCE = 85;
const CAMERA_ANIM_DURATION_SEC = 0.4;
const CAMERA_LERP_SPEED = 1 / CAMERA_ANIM_DURATION_SEC;
const TWO_PI = Math.PI * 2;

function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % TWO_PI) + TWO_PI * 1.5) % TWO_PI) - Math.PI;
  return from + delta * t;
}

/** OrbitControls internal fields we sync after programmatic camera moves. */
type OrbitControlsInternals = OrbitControls & {
  _spherical: THREE.Spherical;
  _sphericalDelta: THREE.Spherical;
  _panOffset: THREE.Vector3;
  _quat: THREE.Quaternion;
  _quatInverse: THREE.Quaternion;
  _scale: number;
};

export class SpaceScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private isVisible = true;
  private autoRotateListeners = new Set<(enabled: boolean) => void>();
  private labelVisibilityListeners = new Set<(visible: boolean) => void>();

  private pointSprite = softCircleSprite();
  private repoFactory = new RepoVisualFactory();
  private background: BackgroundLayer;
  private galaxies: GalaxyLayer;
  private blackholeMerge: BlackholeMergeLayer;
  private picker: RaycastPicker;

  private activeClusterGroup = new THREE.Group();
  private detailClusterGroup = new THREE.Group();

  private activeEventParticles: EventParticleLayer;
  private detailEventParticles: EventParticleLayer;
  private activeNodes: GraphNodeLayer;
  private detailNodes: GraphNodeLayer;
  private activeLinks: LinkLayer;
  private detailLinks: LinkLayer;
  private flights: EventFlightLayer;

  private viewMode: CosmosViewMode = 'overview';
  private galaxyTapListener: ((archiveId: string) => void) | null = null;

  private cameraAnim: {
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromSpherical: THREE.Spherical;
    toSpherical: THREE.Spherical;
    progress: number;
    dampingWasEnabled: boolean;
  } | null = null;

  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private readonly mergeWorldPosition = new THREE.Vector3();

  private mergeInProgress = false;
  private mergeCallback: (() => void) | null = null;
  private mergeSpawnGalaxy: GalaxyArchiveRef | null = null;
  private mergeArchiveCountBefore = 0;
  private postMergeFadeStart = 0;
  private mergeFrame: ReturnType<BlackholeMergeLayer['update']> | null = null;

  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible) {
      this.timer.connect(document);
      this.renderer.setAnimationLoop(this.animate);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.activeEventParticles = new EventParticleLayer(
      this.pointSprite,
      this.repoFactory.burstRingGeo,
    );
    this.detailEventParticles = new EventParticleLayer(
      this.pointSprite,
      this.repoFactory.burstRingGeo,
    );
    this.detailEventParticles.enableSnapshotMode();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x020014, 0.0035);

    const { clientWidth, clientHeight } = container;
    this.camera = new THREE.PerspectiveCamera(
      55,
      clientWidth / clientHeight,
      0.1,
      500,
    );
    this.camera.position.set(0, 35, OVERVIEW_CAMERA_DISTANCE_BASE);

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
    canvas.style.zIndex = '0';

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
      this.cameraAnim = null;
    });

    this.picker = new RaycastPicker(this.renderer.domElement, this.camera);
    this.picker.setOnTap((archiveId) => {
      this.galaxyTapListener?.(archiveId);
    });

    const ambient = new THREE.AmbientLight(0x6a7aaa, 1.1);
    this.scene.add(ambient);

    this.background = new BackgroundLayer(this.pointSprite);
    this.background.addTo(this.scene);

    this.galaxies = new GalaxyLayer();
    this.blackholeMerge = new BlackholeMergeLayer();
    this.scene.add(this.galaxies.group);
    this.scene.add(this.blackholeMerge.group);

    this.activeNodes = new GraphNodeLayer(
      this.activeClusterGroup,
      this.activeEventParticles,
      this.repoFactory,
      this.timer,
    );
    this.detailNodes = new GraphNodeLayer(
      this.detailClusterGroup,
      this.detailEventParticles,
      this.repoFactory,
      this.timer,
    );

    this.activeLinks = new LinkLayer(this.activeNodes);
    this.detailLinks = new LinkLayer(this.detailNodes);
    this.activeNodes.setLinkVisibilityHandler(() =>
      this.activeLinks.applyVisibility(),
    );
    this.detailNodes.setLinkVisibilityHandler(() =>
      this.detailLinks.applyVisibility(),
    );

    this.flights = new EventFlightLayer(
      this.activeNodes,
      this.activeEventParticles,
      this.pointSprite,
    );

    this.activeClusterGroup.add(this.activeLinks.group);
    this.activeClusterGroup.add(this.activeEventParticles.group);
    this.activeClusterGroup.add(this.flights.group);

    this.detailClusterGroup.add(this.detailLinks.group);
    this.detailClusterGroup.add(this.detailEventParticles.group);

    this.scene.add(this.activeClusterGroup);
    this.scene.add(this.detailClusterGroup);
    this.detailClusterGroup.visible = false;

    this.timer.connect(document);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(this.animate);
  }

  setCosmosLayout(input: CosmosLayoutInput): void {
    if (this.mergeInProgress) return;

    const { mode, archives, activeGraphData, detailGraphData } = input;
    const prevMode = this.viewMode;
    this.viewMode = mode;

    this.galaxies.sync(archives);
    this.updateActiveClusterPosition(archives.length);

    const activeLinks = this.activeNodes.updateGraph(activeGraphData, () =>
      this.flights.clear(),
    );
    this.activeLinks.syncLinks(activeLinks);

    if (mode === 'detail' && detailGraphData) {
      this.activeClusterGroup.visible = false;
      this.galaxies.group.visible = false;
      this.detailClusterGroup.visible = true;

      const detailLinks = this.detailNodes.updateGraph(
        detailGraphData,
        () => {},
      );
      this.detailLinks.syncLinks(detailLinks);
      this.detailNodes.instantRevealAllEvents();

      this.picker.setTargets([], false);
      if (prevMode !== 'detail') {
        this.focusCamera(
          this.scratchTarget.set(0, 0, 0),
          DETAIL_CAMERA_DISTANCE,
          true,
        );
      }
    } else {
      this.activeClusterGroup.visible = true;
      this.galaxies.group.visible = archives.length > 0;
      this.detailClusterGroup.visible = false;

      this.picker.setTargets(
        this.galaxies.getHitTargets(),
        archives.length > 0,
      );
    }

    this.updateOrbitLimits(archives.length);
  }

  onGalaxyTap(listener: ((archiveId: string) => void) | null): void {
    this.galaxyTapListener = listener;
  }

  updateGraph(data: GraphData): void {
    if (this.mergeInProgress) return;
    const links = this.activeNodes.updateGraph(data, () =>
      this.flights.clear(),
    );
    this.activeLinks.syncLinks(links);
  }

  isMergeAnimating(): boolean {
    return this.mergeInProgress;
  }

  startMergeAnimation(
    archive: GalaxyArchiveRef,
    archiveIndex: number,
    onComplete: () => void,
  ): void {
    if (this.mergeInProgress || this.viewMode === 'detail') return;

    this.mergeInProgress = true;
    this.mergeCallback = onComplete;
    this.mergeSpawnGalaxy = archive;
    this.mergeArchiveCountBefore = archiveIndex;
    this.flights.clear();
    this.postMergeFadeStart = 0;

    this.activeClusterGroup.getWorldPosition(this.mergeWorldPosition);

    this.activeNodes.beginMergeSuck();
    this.activeEventParticles.setMergeSuck(0);
    this.activeClusterGroup.rotation.set(0, 0, 0);
    this.blackholeMerge.start(this.mergeWorldPosition, performance.now());
    this.setAutoRotate(false);
  }

  /** Finish an in-flight merge immediately (e.g. after returning from a background tab). */
  skipMergeAnimation(): void {
    if (!this.mergeInProgress) return;

    const archiveIndex = this.mergeArchiveCountBefore;
    const archiveSlot = archiveWorldOffset(archiveIndex);

    if (this.mergeSpawnGalaxy) {
      this.galaxies.spawnGalaxyAt(
        this.mergeSpawnGalaxy,
        archiveIndex,
        archiveSlot,
        1,
      );
    }
    this.blackholeMerge.cancel();
    this.activeNodes.clearMergeSuck();
    this.activeEventParticles.clearMergeSuck();

    const callback = this.mergeCallback;
    const spawnedArchive = this.mergeSpawnGalaxy;

    this.mergeInProgress = false;
    this.mergeCallback = null;
    this.mergeSpawnGalaxy = null;
    this.mergeFrame = null;

    if (spawnedArchive) {
      this.galaxies.finalizePostMergeArchive(archiveIndex, spawnedArchive.id);
    }
    this.updateActiveClusterPosition(archiveIndex + 1);
    this.activeClusterGroup.visible = true;
    this.activeClusterGroup.scale.setScalar(1);
    this.activeClusterGroup.rotation.set(0, 0, 0);
    this.postMergeFadeStart = 0;

    callback?.();
  }

  /** Commit a merge without playing the blackhole animation. */
  instantCompleteMerge(
    archive: GalaxyArchiveRef,
    archiveIndex: number,
    onComplete: () => void,
  ): void {
    if (this.mergeInProgress) {
      this.skipMergeAnimation();
      return;
    }

    const archiveSlot = archiveWorldOffset(archiveIndex);

    this.flights.clear();
    this.galaxies.spawnGalaxyAt(archive, archiveIndex, archiveSlot, 1);
    this.galaxies.finalizePostMergeArchive(archiveIndex, archive.id);
    this.updateActiveClusterPosition(archiveIndex + 1);
    this.activeClusterGroup.visible = true;
    this.activeClusterGroup.scale.setScalar(1);
    this.activeClusterGroup.rotation.set(0, 0, 0);
    this.postMergeFadeStart = 0;
    onComplete();
  }

  clearEventFlights(): void {
    this.flights.clear();
  }

  loadMergeGraph(data: GraphData): void {
    const links = this.activeNodes.updateGraph(data, () =>
      this.flights.clear(),
    );
    this.activeLinks.syncLinks(links);
    this.activeNodes.instantRevealAllEvents();
  }

  enqueueEventFlight(payload: EventFlightPayload): void {
    if (this.viewMode === 'detail' || this.mergeInProgress) return;
    this.flights.enqueue(payload);
  }

  setActiveEventTypes(types: Set<string>): void {
    this.activeNodes.setActiveEventTypes(types);
    this.detailNodes.setActiveEventTypes(types);
  }

  syncEventTypeFilterVisibility(): void {
    this.activeNodes.syncEventTypeFilterVisibility();
    if (this.viewMode === 'detail') {
      this.detailNodes.syncEventTypeFilterVisibility();
    }
  }

  instantRevealEvent(eventId: string): void {
    this.activeNodes.instantRevealEvent(eventId);
  }

  instantRevealActiveCluster(): void {
    this.activeNodes.instantRevealAllEvents();
  }

  focusGlobal(archiveCount: number, immediate = false): void {
    const distance = OVERVIEW_CAMERA_DISTANCE_BASE + archiveCount * 25;
    this.updateOrbitLimits(archiveCount);
    this.focusCamera(this.scratchTarget.set(0, 0, 0), distance, !immediate);
  }

  focusGalaxy(
    archiveIndex: number,
    _archiveCount: number,
    immediate = false,
  ): void {
    const position = archiveWorldOffset(archiveIndex);
    this.focusCamera(position, GALAXY_CAMERA_DISTANCE, !immediate);
  }

  focusActiveCluster(_archiveCount: number, immediate = false): void {
    const position = new THREE.Vector3();
    this.activeClusterGroup.getWorldPosition(position);
    this.focusCamera(position, ACTIVE_CLUSTER_CAMERA_DISTANCE, !immediate);
  }

  /** Focus camera on a nav target (used by overview navigation buttons). */
  navigateTo(
    target: 'global' | 'active' | string,
    archiveIds: string[],
    options: { smooth?: boolean } = {},
  ): void {
    if (this.mergeInProgress) return;
    const smooth = options.smooth ?? true;
    const immediate = !smooth;
    const archiveCount = archiveIds.length;
    if (target === 'global') {
      this.focusGlobal(archiveCount, immediate);
      return;
    }
    if (target === 'active') {
      this.focusActiveCluster(archiveCount, immediate);
      return;
    }
    if (this.galaxies.getWorldPositionForArchive(target, this.scratchTarget)) {
      this.focusCamera(this.scratchTarget, GALAXY_CAMERA_DISTANCE, smooth);
      return;
    }
    const index = archiveIds.indexOf(target);
    if (index >= 0) {
      this.focusGalaxy(index, archiveCount, immediate);
      return;
    }
    this.focusGlobal(archiveCount, immediate);
  }

  focusCamera(target: THREE.Vector3, distance: number, animate: boolean): void {
    const desiredPosition = new THREE.Vector3(
      target.x,
      target.y + 35,
      target.z + distance,
    );

    this.setAutoRotate(false);

    if (!animate) {
      this.applyCameraPose(target, desiredPosition, true);
      this.cameraAnim = null;
      return;
    }

    this.clearOrbitControlsMomentum();
    const controls = this.controls as OrbitControlsInternals;

    const fromSpherical = new THREE.Spherical();
    this.scratchOffset
      .copy(this.camera.position)
      .sub(this.controls.target)
      .applyQuaternion(controls._quat);
    fromSpherical.setFromVector3(this.scratchOffset);

    const toSpherical = new THREE.Spherical();
    this.scratchOffset
      .copy(desiredPosition)
      .sub(target)
      .applyQuaternion(controls._quat);
    toSpherical.setFromVector3(this.scratchOffset);

    this.cameraAnim = {
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      fromSpherical,
      toSpherical,
      progress: 0,
      dampingWasEnabled: this.controls.enableDamping,
    };
    this.controls.enableDamping = false;
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
    return this.activeNodes.getLabelsVisible();
  }

  setLabelsVisible(visible: boolean): void {
    if (this.activeNodes.getLabelsVisible() === visible) return;
    this.activeNodes.setLabelsVisible(visible);
    this.detailNodes.setLabelsVisible(visible);
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

  private updateOrbitLimits(archiveCount: number): void {
    this.controls.maxDistance = 180 + archiveCount * 40;
  }

  private updateActiveClusterPosition(archiveCount: number): void {
    this.activeClusterGroup.position.copy(
      activeClusterWorldOffset(archiveCount),
    );
  }

  private updateCameraAnimation(delta: number): boolean {
    if (!this.cameraAnim) return false;

    const anim = this.cameraAnim;
    anim.progress = Math.min(anim.progress + delta * CAMERA_LERP_SPEED, 1);
    const cameraEaseT = 1 - (1 - anim.progress) ** 3;
    const controls = this.controls as OrbitControlsInternals;

    const radius = THREE.MathUtils.lerp(
      anim.fromSpherical.radius,
      anim.toSpherical.radius,
      cameraEaseT,
    );
    const phi = THREE.MathUtils.lerp(
      anim.fromSpherical.phi,
      anim.toSpherical.phi,
      cameraEaseT,
    );
    const theta = lerpAngle(
      anim.fromSpherical.theta,
      anim.toSpherical.theta,
      cameraEaseT,
    );

    this.controls.target.lerpVectors(
      anim.fromTarget,
      anim.toTarget,
      cameraEaseT,
    );
    controls._spherical.set(radius, phi, theta);
    this.scratchOffset
      .setFromSpherical(controls._spherical)
      .applyQuaternion(controls._quatInverse);
    this.camera.position.copy(this.controls.target).add(this.scratchOffset);
    this.camera.lookAt(this.controls.target);
    this.clearOrbitControlsMomentum();

    if (anim.progress >= 1) {
      this.controls.target.copy(anim.toTarget);
      controls._spherical.copy(anim.toSpherical);
      this.scratchOffset
        .setFromSpherical(anim.toSpherical)
        .applyQuaternion(controls._quatInverse);
      this.camera.position.copy(this.controls.target).add(this.scratchOffset);
      this.camera.lookAt(anim.toTarget);
      this.clearOrbitControlsMomentum();
      this.controls.enableDamping = anim.dampingWasEnabled;
      this.cameraAnim = null;
    }

    return true;
  }

  private clearOrbitControlsMomentum(): void {
    const controls = this.controls as OrbitControlsInternals;
    controls._sphericalDelta.set(0, 0, 0);
    controls._panOffset.set(0, 0, 0);
    controls._scale = 1;
  }

  /** Mirror the current camera pose into OrbitControls without moving the camera. */
  private syncOrbitControlsFromCamera(): void {
    const controls = this.controls as OrbitControlsInternals;
    this.scratchOffset
      .copy(this.camera.position)
      .sub(this.controls.target)
      .applyQuaternion(controls._quat);
    controls._spherical.setFromVector3(this.scratchOffset);
    this.clearOrbitControlsMomentum();
  }

  /** Set camera pose and sync OrbitControls without applying stale momentum. */
  private applyCameraPose(
    target: THREE.Vector3,
    position: THREE.Vector3,
    restoreDamping: boolean,
  ): void {
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.syncOrbitControlsFromCamera();
    this.controls.enableDamping = restoreDamping;
  }

  private finishMergeAnimation(): void {
    if (!this.mergeInProgress) return;

    const newArchiveCount = this.mergeArchiveCountBefore + 1;
    const spawnedArchive = this.mergeSpawnGalaxy;

    this.mergeInProgress = false;
    this.activeNodes.clearMergeSuck();
    this.activeEventParticles.clearMergeSuck();

    if (spawnedArchive) {
      this.galaxies.finalizePostMergeArchive(
        this.mergeArchiveCountBefore,
        spawnedArchive.id,
      );
    }
    this.updateActiveClusterPosition(newArchiveCount);

    this.activeClusterGroup.scale.setScalar(0.01);
    this.activeClusterGroup.rotation.set(0, 0, 0);
    this.postMergeFadeStart = performance.now();

    const callback = this.mergeCallback;
    this.mergeCallback = null;
    this.mergeSpawnGalaxy = null;
    callback?.();
  }

  private updatePostMergeFade(now: number): void {
    if (this.postMergeFadeStart <= 0) return;
    const fadeProgress = Math.min((now - this.postMergeFadeStart) / 600, 1);
    const scale = 0.01 + (1 - 0.01) * (1 - (1 - fadeProgress) ** 3);
    this.activeClusterGroup.scale.setScalar(scale);
    if (fadeProgress >= 1) {
      this.activeClusterGroup.scale.setScalar(1);
      this.postMergeFadeStart = 0;
    }
  }

  private updateMergeAnimation(now: number): void {
    const frame = this.blackholeMerge.update(now);
    this.mergeFrame = frame;

    this.activeEventParticles.setMergeSuck(
      frame.phase === 'suck' || frame.phase === 'collapse' ? frame.suckT : 1,
    );

    if (frame.phase === 'suck' || frame.phase === 'collapse') {
      this.activeClusterGroup.rotation.y = frame.clusterSpin;
      this.activeClusterGroup.scale.setScalar(frame.clusterScale);
    } else {
      this.activeClusterGroup.rotation.y = 0;
      this.activeClusterGroup.scale.setScalar(
        Math.max(frame.clusterScale, 0.001),
      );
    }

    if (this.mergeSpawnGalaxy && frame.phase === 'spawn') {
      this.galaxies.spawnGalaxyAt(
        this.mergeSpawnGalaxy,
        this.mergeArchiveCountBefore,
        this.mergeWorldPosition,
        frame.galaxySpawnT,
      );
    }

    if (frame.done) {
      this.finishMergeAnimation();
    }
  }

  private animate = (timestamp?: number): void => {
    if (!this.isVisible) return;

    this.timer.update(timestamp);
    const now = performance.now();
    const time = this.timer.getElapsed();
    const delta = this.timer.getDelta();

    const cameraAnimating = this.updateCameraAnimation(delta);
    if (!cameraAnimating) {
      this.controls.update();
    }
    this.picker.updateHover();

    if (this.mergeInProgress) {
      this.updateMergeAnimation(now);
      this.activeEventParticles.advancePositions(time);
      this.activeNodes.update(now, pointsAttenuationScale(this.renderer));
      const frame = this.mergeFrame;
      if (frame && (frame.phase === 'suck' || frame.phase === 'collapse')) {
        this.activeNodes.applyMergeSuck(frame.suckT, frame.clusterOpacity);
        this.activeLinks.applyMergeOpacity(frame.clusterOpacity);
      } else {
        this.activeLinks.applyMergeOpacity(0);
      }
      this.activeLinks.updatePositions();
      this.galaxies.update(time);
      this.background.update(time);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.postMergeFadeStart > 0) {
      this.updatePostMergeFade(now);
    }

    if (this.viewMode === 'detail') {
      this.detailEventParticles.advancePositions(time);
      this.detailNodes.update(now, pointsAttenuationScale(this.renderer));
      this.detailLinks.updatePositions();
    } else {
      this.activeEventParticles.advancePositions(time);
      this.flights.update(now);
      this.activeNodes.update(now, pointsAttenuationScale(this.renderer));
      this.activeLinks.updatePositions();
      this.flights.processQueue();
      this.galaxies.update(time);
    }

    this.background.update(time);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.timer.dispose();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.picker.dispose();

    this.flights.dispose();
    this.activeNodes.dispose();
    this.detailNodes.dispose();
    this.activeLinks.dispose();
    this.detailLinks.dispose();
    this.galaxies.dispose();
    this.blackholeMerge.dispose();
    this.background.dispose();
    this.repoFactory.disposeSharedGeometries();
    this.activeEventParticles.dispose();
    this.detailEventParticles.dispose();
    disposeLabelTextures();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
