import * as THREE from 'three';

export class BackgroundLayer {
  private starfield: THREE.Points;
  private nebula: THREE.Points;

  constructor(pointSprite: THREE.Texture) {
    this.starfield = this.createStarfield(2500, pointSprite);
    this.nebula = this.createNebula(60, pointSprite);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.starfield);
    scene.add(this.nebula);
  }

  update(time: number): void {
    this.starfield.rotation.y = time * 0.008;
    this.nebula.rotation.y = -time * 0.003;
  }

  dispose(): void {
    this.starfield.geometry.dispose();
    (this.starfield.material as THREE.Material).dispose();
    this.nebula.geometry.dispose();
    (this.nebula.material as THREE.Material).dispose();
  }

  private createStarfield(
    count: number,
    pointSprite: THREE.Texture,
  ): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let starIndex = 0; starIndex < count; starIndex++) {
      const radius = 120 + Math.random() * 180;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[starIndex * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[starIndex * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[starIndex * 3 + 2] = radius * Math.cos(phi);

      const tint = Math.random();
      if (tint < 0.15) color.setHSL(0.75, 0.5, 0.75);
      else if (tint < 0.3) color.setHSL(0.58, 0.45, 0.8);
      else color.setHSL(0.6, 0.1, 0.85 + Math.random() * 0.15);

      colors[starIndex * 3] = color.r;
      colors[starIndex * 3 + 1] = color.g;
      colors[starIndex * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.55,
      map: pointSprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      alphaTest: 0.01,
    });

    return new THREE.Points(geometry, material);
  }

  private createNebula(
    count: number,
    pointSprite: THREE.Texture,
  ): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let nebulaIndex = 0; nebulaIndex < count; nebulaIndex++) {
      positions[nebulaIndex * 3] = (Math.random() - 0.5) * 200;
      positions[nebulaIndex * 3 + 1] = (Math.random() - 0.5) * 80;
      positions[nebulaIndex * 3 + 2] = (Math.random() - 0.5) * 200;

      const hue = 0.72 + Math.random() * 0.15;
      color.setHSL(hue, 0.7, 0.35 + Math.random() * 0.2);
      colors[nebulaIndex * 3] = color.r;
      colors[nebulaIndex * 3 + 1] = color.g;
      colors[nebulaIndex * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 14,
      map: pointSprite,
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
}
