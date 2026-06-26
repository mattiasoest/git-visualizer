import * as THREE from 'three';

export interface SizedPointsMaterial extends THREE.ShaderMaterial {
  uniforms: {
    map: { value: THREE.Texture | null };
    opacity: { value: number };
    scale: { value: number };
  };
}

/** PointsMaterial that respects a per-vertex `size` attribute (unlike the built-in material). */
export function createSizedPointsMaterial(
  map: THREE.Texture,
  options: {
    opacity: number;
    blending?: THREE.Blending;
    depthWrite?: boolean;
  },
): SizedPointsMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      opacity: { value: options.opacity },
      scale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 particleColor;
      attribute float size;
      varying vec3 vParticleColor;
      uniform float scale;

      void main() {
        vParticleColor = particleColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (scale / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float opacity;
      varying vec3 vParticleColor;

      void main() {
        vec4 texColor = texture2D(map, gl_PointCoord);
        if (texColor.a < 0.01) discard;
        gl_FragColor = vec4(vParticleColor, opacity * texColor.a);
      }
    `,
    transparent: true,
    depthWrite: options.depthWrite ?? false,
    depthTest: false,
    blending: options.blending ?? THREE.NormalBlending,
  }) as SizedPointsMaterial;
}

export function pointsAttenuationScale(renderer: THREE.WebGLRenderer): number {
  return renderer.getPixelRatio() * 0.5 * renderer.domElement.height;
}
