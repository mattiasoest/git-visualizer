import * as THREE from 'three';
import { segmentWorldOffset, totalSegmentCount } from '../utils/galaxyLayout';
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

export class GalaxyLayer {
  readonly group = new THREE.Group();
  private factory = new GalaxyVisualFactory();
  private entries = new Map<string, GalaxyEntry>();

  sync(archives: GalaxyArchiveRef[]): void {
    const nextIds = new Set(archives.map((archive) => archive.id));
    const segments = totalSegmentCount(archives.length);

    for (const [id, entry] of this.entries) {
      if (nextIds.has(id)) continue;
      this.group.remove(entry.visual.group);
      this.factory.disposeGalaxy(entry.visual);
      this.entries.delete(id);
    }

    archives.forEach((archive, index) => {
      const offset = segmentWorldOffset(index, segments);
      const labelText = formatEventCount(archive.eventCount);
      const existing = this.entries.get(archive.id);

      if (existing) {
        existing.visual.group.position.copy(offset);
        return;
      }

      const visual = this.factory.createGalaxy(
        archive.eventCount,
        archive.id,
        labelText,
      );
      visual.group.position.copy(offset);
      this.group.add(visual.group);
      this.entries.set(archive.id, { archiveId: archive.id, visual });
    });
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
