import * as THREE from 'three';
import { GALAXY_CORE_RADIUS } from '../utils/constants';
import { createLabelSprite } from '../utils/labelSprite';
import { softCircleSprite } from '../utils/softSprite';

export interface GalaxyVisual {
  group: THREE.Group;
  hitSphere: THREE.Mesh;
  label: THREE.Sprite;
}

export class GalaxyVisualFactory {
  private readonly coreGeo = new THREE.SphereGeometry(1, 16, 16);
  private readonly armGeoA = new THREE.TorusGeometry(1, 0.06, 8, 48);
  private readonly armGeoB = new THREE.TorusGeometry(1, 0.045, 8, 40);
  private readonly coreMat = new THREE.MeshBasicMaterial({
    color: 0x9b7bff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly armMatA = new THREE.MeshBasicMaterial({
    color: 0x6e4fd4,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly armMatB = new THREE.MeshBasicMaterial({
    color: 0xc4a8ff,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly hitMat = new THREE.MeshBasicMaterial({
    visible: false,
  });
  private readonly pointSprite = softCircleSprite();

  createGalaxy(eventCount: number, archiveId: string, labelText: string): GalaxyVisual {
    const group = new THREE.Group();
    group.userData = { kind: 'galaxy', archiveId };

    const scale = GALAXY_CORE_RADIUS * (0.85 + Math.log10(Math.max(eventCount, 10)) * 0.15);

    const core = new THREE.Mesh(this.coreGeo, this.coreMat.clone());
    core.scale.setScalar(scale * 0.35);
    group.add(core);

    const armA = new THREE.Mesh(this.armGeoA, this.armMatA.clone());
    armA.rotation.x = Math.PI / 2.4;
    armA.rotation.y = 0.4;
    armA.scale.setScalar(scale);
    group.add(armA);

    const armB = new THREE.Mesh(this.armGeoB, this.armMatB.clone());
    armB.rotation.x = Math.PI / 3.2;
    armB.rotation.z = 0.9;
    armB.scale.setScalar(scale * 0.82);
    group.add(armB);

    const armC = new THREE.Mesh(this.armGeoB, this.armMatB.clone());
    armC.rotation.x = -Math.PI / 2.8;
    armC.rotation.y = 1.2;
    armC.scale.setScalar(scale * 0.65);
    group.add(armC);

    const haloCount = 200;
    const haloPositions = new Float32Array(haloCount * 3);
    const haloColors = new Float32Array(haloCount * 3);
    const color = new THREE.Color(0xa88cff);
    for (let i = 0; i < haloCount; i++) {
      const t = i / haloCount;
      const angle = t * Math.PI * 6;
      const radius = scale * (0.5 + t * 0.9);
      const y = (Math.sin(t * Math.PI * 4) * 0.35 + Math.cos(i * 0.7) * 0.15) * scale * 0.3;
      haloPositions[i * 3] = Math.cos(angle) * radius;
      haloPositions[i * 3 + 1] = y;
      haloPositions[i * 3 + 2] = Math.sin(angle) * radius * 0.85;
      haloColors[i * 3] = color.r;
      haloColors[i * 3 + 1] = color.g;
      haloColors[i * 3 + 2] = color.b;
    }
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3));
    haloGeo.setAttribute('color', new THREE.BufferAttribute(haloColors, 3));
    const halo = new THREE.Points(
      haloGeo,
      new THREE.PointsMaterial({
        size: 1.8,
        map: this.pointSprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(halo);

    const hitSphere = new THREE.Mesh(
      this.coreGeo,
      this.hitMat.clone(),
    );
    hitSphere.scale.setScalar(scale * 1.4);
    hitSphere.userData = { kind: 'galaxy', archiveId };
    group.add(hitSphere);

    const label = createLabelSprite(labelText, 'repo');
    label.position.set(0, scale * 0.9, 0);
    group.add(label);

    return { group, hitSphere, label };
  }

  disposeGalaxy(visual: GalaxyVisual): void {
    for (const child of visual.group.children) {
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        continue;
      }
      if (child instanceof THREE.Mesh) {
        if (Array.isArray(child.material)) {
          for (const material of child.material) material.dispose();
        } else {
          child.material.dispose();
        }
      }
    }
    (visual.label.material as THREE.SpriteMaterial).dispose();
  }

  dispose(): void {
    this.coreGeo.dispose();
    this.armGeoA.dispose();
    this.armGeoB.dispose();
    this.coreMat.dispose();
    this.armMatA.dispose();
    this.armMatB.dispose();
    this.hitMat.dispose();
    this.pointSprite.dispose();
  }
}
