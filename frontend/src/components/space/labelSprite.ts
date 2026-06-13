import * as THREE from 'three';

const STYLES = {
  actor: {
    text: '#a8d4ff',
    background: 'rgba(30, 80, 160, 0.35)',
    border: 'rgba(120, 180, 255, 0.3)',
  },
  repo: {
    text: '#8ee4a0',
    background: 'rgba(20, 80, 40, 0.35)',
    border: 'rgba(80, 200, 120, 0.3)',
  },
} as const;

const LABEL_WORLD_HEIGHT = {
  actor: 1.0,
  repo: 0.85,
} as const;

const textureCache = new Map<string, THREE.CanvasTexture>();

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function getLabelTexture(text: string, kind: 'actor' | 'repo'): THREE.CanvasTexture {
  const key = `${kind}:${text}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const style = STYLES[kind];
  const dpr = 2;
  const fontSize = 11;
  const paddingX = 7;
  const paddingY = 2;
  const borderRadius = 4;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  measureCtx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const textWidth = Math.ceil(measureCtx.measureText(text).width);
  const logicalWidth = textWidth + paddingX * 2;
  const logicalHeight = fontSize + paddingY * 2 + 2;

  const canvas = document.createElement('canvas');
  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = style.background;
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, logicalWidth - 1, logicalHeight - 1, borderRadius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = style.text;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, paddingX, logicalHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

export function createLabelSprite(text: string, kind: 'actor' | 'repo'): THREE.Sprite {
  const texture = getLabelTexture(text, kind);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = texture.image.width / texture.image.height;
  const height = LABEL_WORLD_HEIGHT[kind];
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}

export function disposeLabelTextures(): void {
  for (const texture of textureCache.values()) {
    texture.dispose();
  }
  textureCache.clear();
}
