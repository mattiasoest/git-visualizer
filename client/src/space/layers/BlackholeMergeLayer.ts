import * as THREE from 'three';
import {
  MERGE_COLLAPSE_MS,
  MERGE_EXPLODE_MS,
  MERGE_GALAXY_SPAWN_MS,
  MERGE_SUCK_MS,
} from '../utils/constants';
import { softCircleSprite } from '../utils/softSprite';

export type MergePhase = 'idle' | 'suck' | 'collapse' | 'explode' | 'spawn' | 'done';

export interface MergeFrameState {
  phase: MergePhase;
  suckT: number;
  clusterScale: number;
  clusterSpin: number;
  clusterOpacity: number;
  galaxySpawnT: number;
  done: boolean;
}

interface ShockRing {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  startTime: number;
}

function easeInCubic(progress: number): number {
  return progress * progress * progress;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function easeOutBack(progress: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
}

/** Merge VFX: cluster contents suck to center, then explode into a new galaxy. */
export class BlackholeMergeLayer {
  readonly group = new THREE.Group();

  private phase: MergePhase = 'idle';
  private phaseStart = 0;
  private burstPoints: THREE.Points | null = null;
  private shockRings: ShockRing[] = [];
  private readonly pointSprite = softCircleSprite();
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  start(worldPosition: THREE.Vector3, now: number): void {
    this.reset();
    this.group.position.copy(worldPosition);
    this.phaseStart = now;
    this.phase = 'suck';
  }

  update(now: number): MergeFrameState {
    if (this.phase === 'idle' || this.phase === 'done') {
      return {
        phase: this.phase,
        suckT: 0,
        clusterScale: 1,
        clusterSpin: 0,
        clusterOpacity: 1,
        galaxySpawnT: 0,
        done: this.phase === 'done',
      };
    }

    const elapsed = now - this.phaseStart;

    if (this.phase === 'suck') {
      const suckProgress = Math.min(elapsed / MERGE_SUCK_MS, 1);
      const suckT = easeInCubic(suckProgress) * 0.9;
      if (suckProgress >= 1) this.advancePhase('collapse', now);
      return {
        phase: 'suck',
        suckT,
        clusterScale: 1,
        clusterSpin: suckT * Math.PI * 5,
        clusterOpacity: 1 - suckT * 0.55,
        galaxySpawnT: 0,
        done: false,
      };
    }

    if (this.phase === 'collapse') {
      const collapseProgress = Math.min(elapsed / MERGE_COLLAPSE_MS, 1);
      const suckT = 0.9 + easeOutCubic(collapseProgress) * 0.1;
      if (collapseProgress >= 1) {
        this.spawnExplosion(now);
        this.advancePhase('explode', now);
      }
      return {
        phase: 'collapse',
        suckT,
        clusterScale: Math.max(0.001, 1 - collapseProgress),
        clusterSpin: Math.PI * 5 + collapseProgress * Math.PI * 3,
        clusterOpacity: Math.max(0, 0.45 * (1 - collapseProgress)),
        galaxySpawnT: 0,
        done: false,
      };
    }

    if (this.phase === 'explode') {
      const explodeProgress = Math.min(elapsed / MERGE_EXPLODE_MS, 1);
      this.updateExplosion(explodeProgress, now);
      if (explodeProgress >= 1) this.advancePhase('spawn', now);
      return {
        phase: 'explode',
        suckT: 1,
        clusterScale: 0,
        clusterSpin: 0,
        clusterOpacity: 0,
        galaxySpawnT: 0,
        done: false,
      };
    }

    if (this.phase === 'spawn') {
      const spawnProgress = Math.min(elapsed / MERGE_GALAXY_SPAWN_MS, 1);
      this.updateExplosionFadeout(spawnProgress);
      if (spawnProgress >= 1) {
        this.phase = 'done';
        this.resetMeshes();
      }
      return {
        phase: 'spawn',
        suckT: 1,
        clusterScale: 0,
        clusterSpin: 0,
        clusterOpacity: 0,
        galaxySpawnT: easeOutBack(spawnProgress),
        done: spawnProgress >= 1,
      };
    }

    return {
      phase: 'done',
      suckT: 1,
      clusterScale: 0,
      clusterSpin: 0,
      clusterOpacity: 0,
      galaxySpawnT: 1,
      done: true,
    };
  }

  isActive(): boolean {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  dispose(): void {
    this.reset();
    this.ringGeo.dispose();
    this.pointSprite.dispose();
  }

  private advancePhase(phase: MergePhase, now: number): void {
    this.phase = phase;
    this.phaseStart = now;
  }

  private spawnExplosion(now: number): void {
    const burstCount = 120;
    const positions = new Float32Array(burstCount * 3);
    const colors = new Float32Array(burstCount * 3);
    const colorA = new THREE.Color(0xff88ff);
    const colorB = new THREE.Color(0x66ccff);
    for (let particleIndex = 0; particleIndex < burstCount; particleIndex++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const burstRadius = 2 + Math.random() * 4;
      positions[particleIndex * 3] = Math.sin(phi) * Math.cos(theta) * burstRadius;
      positions[particleIndex * 3 + 1] = Math.sin(phi) * Math.sin(theta) * burstRadius;
      positions[particleIndex * 3 + 2] = Math.cos(phi) * burstRadius;
      const mix = Math.random();
      const lerpedColor = colorA.clone().lerp(colorB, mix);
      colors[particleIndex * 3] = lerpedColor.r;
      colors[particleIndex * 3 + 1] = lerpedColor.g;
      colors[particleIndex * 3 + 2] = lerpedColor.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 3.2,
      map: this.pointSprite,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.burstPoints = new THREE.Points(geo, mat);
    this.group.add(this.burstPoints);

    for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
      const mat = new THREE.MeshBasicMaterial({
        color: ringIndex === 0 ? 0xffffff : 0xc77dff,
        transparent: true,
        opacity: 0.95 - ringIndex * 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.setScalar(0.5 + ringIndex * 0.3);
      this.group.add(mesh);
      this.shockRings.push({ mesh, material: mat, startTime: now + ringIndex * 80 });
    }
  }

  private updateExplosion(progress: number, now: number): void {
    const expand = easeOutCubic(progress);
    if (this.burstPoints) {
      this.burstPoints.scale.setScalar(1 + expand * 18);
      (this.burstPoints.material as THREE.PointsMaterial).opacity = (1 - progress ** 0.7) * 0.95;
    }
    for (const ring of this.shockRings) {
      const ringT = Math.min((now - ring.startTime) / MERGE_EXPLODE_MS, 1);
      if (ringT < 0) continue;
      const eased = easeOutCubic(ringT);
      ring.mesh.scale.setScalar(0.5 + eased * 28);
      ring.material.opacity = (0.95 - ringT) * 0.85;
    }
  }

  private updateExplosionFadeout(progress: number): void {
    const fade = 1 - progress;
    if (this.burstPoints) {
      (this.burstPoints.material as THREE.PointsMaterial).opacity = fade * 0.4;
    }
    for (const ring of this.shockRings) {
      ring.material.opacity = fade * 0.2;
    }
  }

  private resetMeshes(): void {
    if (this.burstPoints) {
      this.group.remove(this.burstPoints);
      this.burstPoints.geometry.dispose();
      (this.burstPoints.material as THREE.Material).dispose();
      this.burstPoints = null;
    }
    for (const ring of this.shockRings) {
      this.group.remove(ring.mesh);
      ring.material.dispose();
    }
    this.shockRings = [];
    this.phase = 'idle';
  }

  private reset(): void {
    this.resetMeshes();
    this.phase = 'idle';
  }
}
