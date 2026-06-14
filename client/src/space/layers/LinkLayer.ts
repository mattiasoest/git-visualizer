import * as THREE from 'three';
import type { GraphLink } from '../utils/graphBuilder';
import { createLinkGeometry, updateLinkEndpoints } from '../utils/linkGeometry';
import type { GraphNodeLayer } from './GraphNodeLayer';

export class LinkLayer {
  readonly group = new THREE.Group();
  private linkLines = new Map<string, THREE.Line>();
  private linkBaseOpacity = new Map<string, number>();

  constructor(private nodes: GraphNodeLayer) {}

  syncLinks(links: GraphLink[]): void {
    const nextKeys = new Set(links.map((link) => link.key));

    for (const [key, line] of this.linkLines) {
      if (nextKeys.has(key)) continue;
      this.group.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.linkLines.delete(key);
      this.linkBaseOpacity.delete(key);
    }

    for (const link of links) {
      const sourcePos = this.nodes.getLinkPosition(link.sourceId);
      const targetPos = this.nodes.getLinkPosition(link.targetId);
      if (!sourcePos || !targetPos) continue;

      const baseOpacity = 0.22 + Math.min(link.weight, 4) * 0.03;
      this.linkBaseOpacity.set(link.key, baseOpacity);
      const visible =
        !this.nodes.isEndpointSpawnDeferred(link.sourceId) &&
        this.nodes.isEventEndpointVisible(link.sourceId);
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
      this.group.add(line);
      this.linkLines.set(link.key, line);
    }
  }

  updatePositions(): void {
    for (const [key, line] of this.linkLines) {
      const arrowIdx = key.indexOf('->');
      if (arrowIdx < 0) continue;
      const sourceId = key.slice(0, arrowIdx);
      const targetId = key.slice(arrowIdx + 2);
      const sourcePos = this.nodes.getLinkPosition(sourceId);
      const targetPos = this.nodes.getLinkPosition(targetId);
      if (!sourcePos || !targetPos) continue;
      updateLinkEndpoints(line, sourcePos, targetPos);

      const baseOpacity = this.linkBaseOpacity.get(key) ?? 0;
      const visible =
        !this.nodes.isEndpointSpawnDeferred(sourceId) &&
        this.nodes.isEventEndpointVisible(sourceId);
      (line.material as THREE.LineBasicMaterial).opacity = visible ? baseOpacity : 0;
    }
  }

  applyVisibility(): void {
    for (const [key, line] of this.linkLines) {
      const arrowIdx = key.indexOf('->');
      if (arrowIdx < 0) continue;
      const sourceId = key.slice(0, arrowIdx);
      const baseOpacity = this.linkBaseOpacity.get(key) ?? 0;
      const typeVisible =
        !sourceId.startsWith('event:') || this.nodes.isEventEndpointVisible(sourceId);
      const spawnVisible = !this.nodes.isEndpointSpawnDeferred(sourceId);
      (line.material as THREE.LineBasicMaterial).opacity =
        typeVisible && spawnVisible ? baseOpacity : 0;
    }
  }

  dispose(): void {
    for (const line of this.linkLines.values()) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.linkLines.clear();
    this.linkBaseOpacity.clear();
  }
}
