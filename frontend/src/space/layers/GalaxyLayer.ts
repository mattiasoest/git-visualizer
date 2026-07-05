import * as THREE from 'three';
import { archiveWorldOffset } from '../utils/galaxyLayout';
import { GalaxyVisualFactory, type GalaxyVisual } from './GalaxyVisualFactory';

export interface GalaxyArchiveRef {
  id: string;
  eventCount: number;
}

interface GalaxyEntry {
  archiveId: string;
  visual: GalaxyVisual;
}

function formatEventCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k events`;
  }
  return `${count} events`;
}

function formatGalaxyLabel(archiveIndex: number, eventCount: number): string {
  return `Galaxy ${archiveIndex + 1}\n${formatEventCount(eventCount)}`;
}

export class GalaxyLayer {
  readonly group = new THREE.Group();
  private factory = new GalaxyVisualFactory();
  private entries = new Map<string, GalaxyEntry>();

  sync(archives: GalaxyArchiveRef[]): void {
    const nextIds = new Set(archives.map((archive) => archive.id));

    for (const [id, entry] of this.entries) {
      if (nextIds.has(id)) continue;
      this.group.remove(entry.visual.group);
      this.factory.disposeGalaxy(entry.visual);
      this.entries.delete(id);
    }

    archives.forEach((archive, index) => {
      const labelText = formatGalaxyLabel(index, archive.eventCount);
      const existing = this.entries.get(archive.id);
      const slot = archiveWorldOffset(index);

      if (existing) {
        existing.visual.group.position.copy(slot);
        existing.visual.group.scale.setScalar(1);
        return;
      }

      const visual = this.factory.createGalaxy(
        archive.eventCount,
        archive.id,
        labelText,
      );
      visual.group.position.copy(slot);
      this.group.add(visual.group);
      this.entries.set(archive.id, { archiveId: archive.id, visual });
    });
  }

  /** Spawn or update a galaxy during merge animation before it is committed to archives. */
  spawnGalaxyAt(
    archive: GalaxyArchiveRef,
    archiveIndex: number,
    worldPosition: THREE.Vector3,
    scale: number,
  ): void {
    let entry = this.entries.get(archive.id);
    if (!entry) {
      const labelText = formatGalaxyLabel(archiveIndex, archive.eventCount);
      const visual = this.factory.createGalaxy(
        archive.eventCount,
        archive.id,
        labelText,
      );
      visual.group.position.copy(worldPosition);
      this.group.add(visual.group);
      entry = { archiveId: archive.id, visual };
      this.entries.set(archive.id, entry);
    }
    entry.visual.group.position.copy(worldPosition);
    entry.visual.group.scale.setScalar(Math.max(scale, 0.001));
  }

  /** Lock in the newly archived galaxy at its fixed archive slot. */
  finalizePostMergeArchive(archiveIndex: number, archiveId: string): void {
    const entry = this.entries.get(archiveId);
    if (!entry) return;
    entry.visual.group.position.copy(archiveWorldOffset(archiveIndex));
    entry.visual.group.scale.setScalar(1);
  }

  setGalaxyScale(archiveId: string, scale: number): void {
    const entry = this.entries.get(archiveId);
    if (entry) entry.visual.group.scale.setScalar(Math.max(scale, 0.001));
  }

  getHitTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const entry of this.entries.values()) {
      targets.push(entry.visual.hitSphere);
    }
    return targets;
  }

  getWorldPositionForArchive(archiveId: string, out: THREE.Vector3): boolean {
    const entry = this.entries.get(archiveId);
    if (!entry) return false;
    entry.visual.group.getWorldPosition(out);
    return true;
  }

  update(time: number): void {
    for (const entry of this.entries.values()) {
      const { group } = entry.visual;
      group.rotation.y = time * 0.12;
      const core = group.children[0];
      if (core) {
        core.rotation.x = Math.sin(time * 0.4) * 0.2;
        core.rotation.z = Math.cos(time * 0.35) * 0.15;
      }
      const armA = group.children[1];
      if (armA) armA.rotation.z = time * 0.55;
      const armB = group.children[2];
      if (armB) armB.rotation.y = -time * 0.42;
      const armC = group.children[3];
      if (armC) armC.rotation.x = time * 0.38;
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      this.factory.disposeGalaxy(entry.visual);
    }
    this.entries.clear();
    this.factory.dispose();
  }
}
