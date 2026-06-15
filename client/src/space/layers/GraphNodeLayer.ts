import * as THREE from 'three';
import { computeHierarchicalPositions } from '../utils/clusterLayout';
import {
  EVENT_NODE_BASE_RADIUS,
  EVENT_SPAWN_MS,
  REPO_SPAWN_MS,
  SPAWN_DEFERRED,
} from '../utils/constants';
import type { GraphData, GraphLink, GraphNode } from '../utils/graphBuilder';
import { computeEventBurstGrouping, eventNodeId } from '../utils/graphBuilder';
import {
  createEventLabelSprite,
  createLabelSprite,
  disposeEventLabel,
} from '../utils/labelSprite';
import type { NodeState } from '../utils/types';
import { EVENT_SPAWN_DEFERRED, type EventParticleLayer } from './EventParticleLayer';
import type { RepoVisualFactory } from './RepoVisualFactory';

export class GraphNodeLayer {
  private nodeStates = new Map<string, NodeState>();
  private positions = new Map<string, THREE.Vector3>();
  private nodeTopology = new Set<string>();
  private linkTopology = new Set<string>();
  private eventNodes: GraphNode[] = [];
  private spawnedEventNodeIds = new Set<string>();
  private activeEventTypes = new Set<string>();
  private labelsVisible = true;
  private graphHasNodes = false;
  private applyLinkVisibility: () => void = () => {};
  private mergeSuckActive = false;
  private mergeBasePositions = new Map<string, THREE.Vector3>();
  private readonly mergeOrigin = new THREE.Vector3();

  constructor(
    private rootGroup: THREE.Group,
    private eventParticles: EventParticleLayer,
    private repoFactory: RepoVisualFactory,
    private clock: THREE.Clock,
  ) {}

  setLinkVisibilityHandler(handler: () => void): void {
    this.applyLinkVisibility = handler;
  }

  getNodeState(id: string): NodeState | undefined {
    return this.nodeStates.get(id);
  }

  getNodePosition(id: string): THREE.Vector3 | undefined {
    if (id.startsWith('event:')) {
      return this.eventParticles.getPosition(id);
    }
    return this.nodeStates.get(id)?.position;
  }

  isEndpointSpawnDeferred(id: string): boolean {
    if (id.startsWith('event:')) {
      return this.eventParticles.isSpawnDeferred(id);
    }
    const state = this.nodeStates.get(id);
    return state ? this.isSpawnDeferred(state) : true;
  }

  getLinkPosition(id: string): THREE.Vector3 | undefined {
    if (id.startsWith('event:')) {
      return this.getNodePosition(id);
    }
    return this.nodeStates.get(id)?.position;
  }

  isEventEndpointVisible(id: string): boolean {
    if (!id.startsWith('event:')) return true;
    if (this.eventParticles.isSuppressed(id)) return false;
    if (this.eventParticles.isHidden(id)) return false;
    if (this.eventParticles.isSpawnDeferred(id)) return false;
    const state = this.nodeStates.get(id);
    return state ? state.anchor.visible : false;
  }

  isSpawnDeferred(state: NodeState): boolean {
    return state.spawnStartTime === SPAWN_DEFERRED;
  }

  isNodeSpawning(state: NodeState, durationMs: number, now: number): boolean {
    if (state.spawnStartTime <= 0) return false;
    return (now - state.spawnStartTime) / durationMs < 1;
  }

  beginNodeSpawn(state: NodeState): void {
    state.spawnStartTime = performance.now();
    state.visual.scale.setScalar(0);
    if (state.node.kind !== 'event') {
      state.label.visible = this.labelsVisible;
      (state.label.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  revealEventNode(state: NodeState): void {
    state.spawnStartTime = performance.now();
    this.eventParticles.beginSpawn(state.node.id);
    state.label.visible = false;
  }

  markEventSpawned(nodeId: string): void {
    if (!nodeId.startsWith('event:') || this.spawnedEventNodeIds.has(nodeId)) return;
    this.spawnedEventNodeIds.add(nodeId);
    this.syncEventParticles();
    this.applyLinkVisibility();
    this.applyNodeLabelVisibility();
  }

  getLabelsVisible(): boolean {
    return this.labelsVisible;
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    this.applyNodeLabelVisibility();
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
    this.markEventSpawned(targetId);
    this.syncIdleNodeLabel(target);
  }

  instantRevealAllEvents(): void {
    for (const state of this.nodeStates.values()) {
      if (state.node.kind === 'repo') {
        this.completeNodeSpawn(state);
        continue;
      }
      if (state.node.kind !== 'event') continue;
      const repoId = state.node.parentRepoId;
      if (repoId) {
        const repo = this.nodeStates.get(repoId);
        if (repo) this.completeNodeSpawn(repo);
      }
      this.completeNodeSpawn(state);
      this.eventParticles.completeSpawn(state.node.id);
      this.markEventSpawned(state.node.id);
    }
    this.syncEventParticles();
    this.applyLinkVisibility();
    this.applyNodeLabelVisibility();
  }

  beginMergeSuck(): void {
    this.mergeSuckActive = true;
    this.mergeBasePositions.clear();
    for (const [id, state] of this.nodeStates) {
      if (state.node.kind === 'event') continue;
      const base = this.positions.get(id)?.clone() ?? state.anchor.position.clone();
      this.mergeBasePositions.set(id, base);
    }
  }

  applyMergeSuck(suckT: number, opacity: number): void {
    if (!this.mergeSuckActive) return;

    const retain = 1 - suckT;
    for (const [id, state] of this.nodeStates) {
      if (state.node.kind === 'event') continue;
      const base = this.mergeBasePositions.get(id);
      if (!base) continue;

      state.anchor.position.lerpVectors(base, this.mergeOrigin, suckT);
      state.position.copy(state.anchor.position);

      if (!this.isSpawnDeferred(state)) {
        const scale = Math.max(0.001, retain);
        state.visual.scale.setScalar(scale);
        this.applyRepoMergeOpacity(state, opacity);
      }
    }
  }

  clearMergeSuck(): void {
    this.mergeSuckActive = false;
    this.mergeBasePositions.clear();
  }

  private applyRepoMergeOpacity(state: NodeState, opacity: number): void {
    const materials = state.repoMaterials;
    if (!materials) return;

    const clamped = Math.max(0, Math.min(1, opacity));
    materials.atmosphere.opacity = clamped * 0.35;
    materials.innerGlow.opacity = clamped * 0.55;
    materials.outerShell.opacity = clamped * 0.75;
    materials.outerWire.opacity = clamped * 0.45;
    materials.innerCore.opacity = clamped * 0.9;
    materials.particle.opacity = clamped * 0.8;

    if (state.repoRingMaterials) {
      for (const material of state.repoRingMaterials) {
        material.opacity = clamped * 0.5;
      }
    }
  }

  updateGraph(data: GraphData, onGraphCleared: () => void): GraphLink[] {
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
      onGraphCleared();
      this.spawnedEventNodeIds.clear();
    }

    this.positions = computeHierarchicalPositions(data.nodes, data.links);

    for (const node of data.nodes) {
      const position = this.positions.get(node.id);
      if (!position) continue;
      this.upsertNode(node, position);
    }

    this.eventNodes = data.nodes.filter((n) => n.kind === 'event');
    this.syncEventParticles();
    this.graphHasNodes = data.nodes.length > 0;
    this.applyNodeLabelVisibility();

    this.nodeTopology = activeIds;
    this.linkTopology = linkKeys;

    return data.links;
  }

  update(now: number, attenuationScale: number): void {
    const time = this.clock.getElapsedTime();
    this.eventParticles.update(time, now, attenuationScale);

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

        if (state.spawnStartTime > 0) {
          const spawnT = Math.min((now - state.spawnStartTime) / EVENT_SPAWN_MS, 1);
          if (spawnT < 1) {
            if (state.node.label && state.node.actorLogin && this.labelsVisible) {
              const labelT = Math.max(0, (spawnT - 0.4) / 0.6);
              if (labelT > 0) {
                state.label.visible = true;
                (state.label.material as THREE.SpriteMaterial).opacity = labelT;
              } else {
                state.label.visible = false;
              }
            } else {
              state.label.visible = false;
            }
          } else {
            state.spawnStartTime = 0;
            this.syncIdleNodeLabel(state);
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

      if (this.mergeSuckActive) {
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

        if (state.repoInnerCore?.visible) {
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
  }

  dispose(): void {
    for (const state of this.nodeStates.values()) {
      this.removeNodeState(state);
    }
    this.nodeStates.clear();
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

  private nodeLabelShouldShow(state: NodeState): boolean {
    if (!this.labelsVisible || !this.graphHasNodes) return false;
    if (!state.anchor.visible) return false;
    if (this.isSpawnDeferred(state)) return false;
    if (state.spawnStartTime > 0) return false;
    if (state.node.kind === 'event') {
      return Boolean(state.node.label && state.node.actorLogin) && !this.eventParticles.isSuppressed(state.node.id);
    }
    return true;
  }

  applyNodeLabelVisibility(): void {
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
          ? Boolean(state.node.label && state.node.actorLogin) &&
            !this.eventParticles.isSuppressed(state.node.id)
          : true;
      state.label.visible = shouldShow;
      if (shouldShow) {
        material.opacity = 1;
      }
    } else {
      state.label.visible = false;
    }
  }

  private syncEventParticles(): void {
    const burstGrouping = computeEventBurstGrouping(this.eventNodes, this.spawnedEventNodeIds);
    const particles = this.eventNodes.map((node) => {
      const state = this.nodeStates.get(node.id);
      const burst = burstGrouping.get(node.id);
      return {
        id: node.id,
        parentRepoId: node.parentRepoId!,
        color: node.color ?? '#8b949e',
        spawnStartTime: state?.spawnStartTime ?? EVENT_SPAWN_DEFERRED,
        pulseUntil: state?.pulseUntil ?? 0,
        sizeScale: burst?.sizeScale ?? 1,
        suppressed: burst?.suppressed ?? false,
        upgraded: burst?.upgraded === true,
      };
    });

    const parentPositions = new Map<string, THREE.Vector3>();
    for (const [id, pos] of this.positions) {
      if (id.startsWith('repo:')) parentPositions.set(id, pos);
    }

    this.eventParticles.sync(particles, parentPositions, this.clock.getElapsedTime());
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
      this.repoFactory.disposeMaterials(state);
    }
    this.disposeNodeLabel(state);
    this.rootGroup.remove(state.anchor);
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
        const scale = this.repoFactory.repoRadius(node.eventCount);
        existing.baseRadius = scale;
        this.repoFactory.syncVisualTier(existing, node.eventCount);
        this.repoFactory.syncOrbitRings(existing, node.eventCount);
        this.repoFactory.applyScales(existing.visual, scale, existing.repoOrbitRings);
        this.repoFactory.applyColors(existing, node.eventCount);
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
    this.rootGroup.add(anchor);

    let visual: THREE.Group;
    let baseRadius: number;
    let repoMaterials: NodeState['repoMaterials'];
    let repoInnerCore: NodeState['repoInnerCore'];

    if (node.kind === 'repo') {
      const repoMesh = this.repoFactory.createMesh(node);
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
      this.repoFactory.syncVisualTier(state, node.eventCount);
      this.repoFactory.syncOrbitRings(state, node.eventCount);
    }
    this.nodeStates.set(node.id, state);
    return state;
  }
}
