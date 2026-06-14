import * as THREE from 'three';

export function createLinkGeometry(source: THREE.Vector3, target: THREE.Vector3): THREE.BufferGeometry {
  const positions = new Float32Array([
    source.x,
    source.y,
    source.z,
    target.x,
    target.y,
    target.z,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

export function updateLinkEndpoints(
  line: THREE.Line,
  source: THREE.Vector3,
  target: THREE.Vector3,
): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  arr[0] = source.x;
  arr[1] = source.y;
  arr[2] = source.z;
  arr[3] = target.x;
  arr[4] = target.y;
  arr[5] = target.z;
  attr.needsUpdate = true;
}
