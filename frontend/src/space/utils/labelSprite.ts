import * as THREE from 'three';
import { MAX_LABEL_TEXTURE_CACHE } from '../utils/constants';

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

function evictOldestTextureIfNeeded(): void {
  while (textureCache.size >= MAX_LABEL_TEXTURE_CACHE) {
    const oldestKey = textureCache.keys().next().value;
    if (oldestKey === undefined) break;
    textureCache.get(oldestKey)?.dispose();
    textureCache.delete(oldestKey);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  rectX: number,
  rectY: number,
  width: number,
  height: number,
  cornerRadius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(rectX + cornerRadius, rectY);
  ctx.lineTo(rectX + width - cornerRadius, rectY);
  ctx.quadraticCurveTo(
    rectX + width,
    rectY,
    rectX + width,
    rectY + cornerRadius,
  );
  ctx.lineTo(rectX + width, rectY + height - cornerRadius);
  ctx.quadraticCurveTo(
    rectX + width,
    rectY + height,
    rectX + width - cornerRadius,
    rectY + height,
  );
  ctx.lineTo(rectX + cornerRadius, rectY + height);
  ctx.quadraticCurveTo(
    rectX,
    rectY + height,
    rectX,
    rectY + height - cornerRadius,
  );
  ctx.lineTo(rectX, rectY + cornerRadius);
  ctx.quadraticCurveTo(rectX, rectY, rectX + cornerRadius, rectY);
  ctx.closePath();
}

export function getLabelTexture(
  text: string,
  kind: 'actor' | 'repo',
): THREE.CanvasTexture {
  const key = `${kind}:${text}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const style = STYLES[kind];
  const dpr = 2;
  const fontSize = 11;
  const paddingX = 7;
  const paddingY = 2;
  const lineGap = 2;
  const borderRadius = 4;
  const lines = text.split('\n');

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  measureCtx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const textWidth = Math.ceil(
    Math.max(...lines.map((line) => measureCtx.measureText(line).width)),
  );
  const logicalWidth = textWidth + paddingX * 2;
  const logicalHeight =
    lines.length * fontSize + (lines.length - 1) * lineGap + paddingY * 2 + 2;

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
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, paddingX, paddingY + lineIndex * (fontSize + lineGap));
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  evictOldestTextureIfNeeded();
  textureCache.set(key, texture);
  return texture;
}

export function createLabelSprite(
  text: string,
  kind: 'actor' | 'repo',
): THREE.Sprite {
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

const COMMIT_LABEL_HEIGHT = 0.72;
const MAX_COMMIT_CHARS = 52;

function truncateCommitText(text: string): string {
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= MAX_COMMIT_CHARS) return firstLine;
  return `${firstLine.slice(0, MAX_COMMIT_CHARS - 1)}…`;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function createCommitLabelSprite(
  text: string,
  accentColor: string,
): THREE.Sprite {
  const displayText = truncateCommitText(text);
  const dpr = 2;
  const fontSize = 10;
  const paddingX = 8;
  const paddingY = 3;
  const borderRadius = 4;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  measureCtx.font = `italic 500 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const textWidth = Math.ceil(measureCtx.measureText(displayText).width);
  const logicalWidth = Math.min(textWidth + paddingX * 2, 280);
  const logicalHeight = fontSize + paddingY * 2 + 2;

  const canvas = document.createElement('canvas');
  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  ctx.font = `italic 500 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = hexToRgba(accentColor, 0.14);
  ctx.strokeStyle = hexToRgba(accentColor, 0.55);
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, logicalWidth - 1, logicalHeight - 1, borderRadius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f0e8e8';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.fillText(
    displayText,
    paddingX,
    logicalHeight / 2,
    logicalWidth - paddingX * 2,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(COMMIT_LABEL_HEIGHT * aspect, COMMIT_LABEL_HEIGHT, 1);
  return sprite;
}

export function disposeCommitLabel(sprite: THREE.Sprite): void {
  const material = sprite.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.dispose();
}

const EVENT_LABEL_HEIGHT = 1.05;
const MAX_EVENT_LABEL_CHARS = 48;

function truncateEventText(text: string): string {
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= MAX_EVENT_LABEL_CHARS) return firstLine;
  return `${firstLine.slice(0, MAX_EVENT_LABEL_CHARS - 1)}…`;
}

export function createEventLabelSprite(
  actorLogin: string,
  eventLabel: string,
  accentColor: string,
): THREE.Sprite {
  const displayEvent = truncateEventText(eventLabel);
  const dpr = 2;
  const actorFontSize = 9;
  const eventFontSize = 10;
  const paddingX = 8;
  const paddingY = 4;
  const lineGap = 2;
  const borderRadius = 4;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  measureCtx.font = `600 ${actorFontSize}px system-ui, -apple-system, sans-serif`;
  const actorWidth = Math.ceil(measureCtx.measureText(actorLogin).width);
  measureCtx.font = `italic 500 ${eventFontSize}px system-ui, -apple-system, sans-serif`;
  const eventWidth = Math.ceil(measureCtx.measureText(displayEvent).width);
  const logicalWidth = Math.min(
    Math.max(actorWidth, eventWidth) + paddingX * 2,
    280,
  );
  const logicalHeight =
    actorFontSize + lineGap + eventFontSize + paddingY * 2 + 2;

  const canvas = document.createElement('canvas');
  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = hexToRgba(accentColor, 0.14);
  ctx.strokeStyle = hexToRgba(accentColor, 0.55);
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, logicalWidth - 1, logicalHeight - 1, borderRadius);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.textBaseline = 'top';

  ctx.font = `600 ${actorFontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#8ee4a0';
  ctx.fillText(actorLogin, paddingX, paddingY, logicalWidth - paddingX * 2);

  ctx.font = `italic 500 ${eventFontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#f0e8e8';
  ctx.fillText(
    displayEvent,
    paddingX,
    paddingY + actorFontSize + lineGap,
    logicalWidth - paddingX * 2,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(EVENT_LABEL_HEIGHT * aspect, EVENT_LABEL_HEIGHT, 1);
  return sprite;
}

export function disposeEventLabel(sprite: THREE.Sprite): void {
  disposeCommitLabel(sprite);
}

export function disposeLabelTextures(): void {
  for (const texture of textureCache.values()) {
    texture.dispose();
  }
  textureCache.clear();
}
