import * as THREE from 'three';
import { hashToUnitVector } from '../utils/clusterLayout';
import {
  REPO_ACTIVITY_MAX,
  REPO_BASE_RADIUS,
  REPO_RING_SCALE,
  REPO_VISUAL,
} from '../utils/constants';
import type { GraphNode } from '../utils/graphBuilder';
import type { NodeState } from '../utils/types';

export class RepoVisualFactory {
  readonly burstRingGeo = new THREE.RingGeometry(1, 1.1, 24);
  private readonly repoOuterCrystalGeo = new THREE.IcosahedronGeometry(1, 1);
  private readonly repoInnerCoreGeo = new THREE.OctahedronGeometry(1, 0);
  private readonly repoOrbitGeo = new THREE.TorusGeometry(1, 0.028, 6, 40);
  private readonly repoOrbitGeoB = new THREE.TorusGeometry(1, 0.02, 6, 36);
  private readonly repoGlowGeo = new THREE.SphereGeometry(1, 12, 12);
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

  repoRadius(eventCount: number): number {
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

  /** 1 = inner core, 2 = + first glow, 3 = full shell (all glows + outer sphere). */
  private repoVisualTier(eventCount: number): number {
    return Math.min(Math.max(eventCount, 1), 3);
  }

  syncVisualTier(state: NodeState, eventCount: number): void {
    const tier = this.repoVisualTier(eventCount);
    const { visual } = state;

    visual.children[REPO_VISUAL.atmosphere].visible = tier >= 3;
    visual.children[REPO_VISUAL.innerGlow].visible = tier >= 2;
    visual.children[REPO_VISUAL.outerShell].visible = tier >= 3;
    visual.children[REPO_VISUAL.outerWire].visible = tier >= 3;
    visual.children[REPO_VISUAL.innerCore].visible = tier >= 1;
  }

  private repoOrbitRingCount(eventCount: number): number {
    if (eventCount < 4) return 0;
    if (eventCount < 6) return 1;
    return 2;
  }

  clearOrbitRings(state: NodeState): void {
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

  syncOrbitRings(state: NodeState, eventCount: number): void {
    const tier = this.repoOrbitRingCount(eventCount);
    if (state.repoRingTier === tier) return;

    this.clearOrbitRings(state);
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

  applyColors(state: NodeState, eventCount: number): void {
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

  applyScales(visual: THREE.Group, scale: number, orbitRings?: THREE.Mesh[]): void {
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

  createMesh(node: GraphNode): {
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

  disposeMaterials(state: NodeState): void {
    if (!state.repoMaterials) return;
    state.repoMaterials.atmosphere.dispose();
    state.repoMaterials.innerGlow.dispose();
    state.repoMaterials.outerShell.dispose();
    state.repoMaterials.outerWire.dispose();
    state.repoMaterials.innerCore.dispose();
    state.repoMaterials = undefined;
    this.clearOrbitRings(state);
    state.repoInnerCore = undefined;
  }

  disposeSharedGeometries(): void {
    this.burstRingGeo.dispose();
    this.repoOuterCrystalGeo.dispose();
    this.repoInnerCoreGeo.dispose();
    this.repoOrbitGeo.dispose();
    this.repoOrbitGeoB.dispose();
    this.repoGlowGeo.dispose();
  }
}
