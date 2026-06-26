import * as THREE from 'three';

const DRAG_THRESHOLD_PX = 5;

export class RaycastPicker {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDown = { x: 0, y: 0 };
  private isPointerDown = false;
  private onTap: ((archiveId: string) => void) | null = null;
  private onHoverChange: ((hovering: boolean) => void) | null = null;
  private wasHovering = false;
  private pickTargets: THREE.Object3D[] = [];
  private pickingEnabled = false;

  constructor(
    private domElement: HTMLElement,
    private camera: THREE.Camera,
  ) {
    domElement.addEventListener('pointerdown', this.handlePointerDown);
    domElement.addEventListener('pointerup', this.handlePointerUp);
    domElement.addEventListener('pointermove', this.handlePointerMove);
  }

  setOnTap(callback: ((archiveId: string) => void) | null): void {
    this.onTap = callback;
  }

  setOnHoverChange(callback: ((hovering: boolean) => void) | null): void {
    this.onHoverChange = callback;
  }

  setTargets(targets: THREE.Object3D[], enabled: boolean): void {
    this.pickTargets = targets;
    this.pickingEnabled = enabled;
    if (!enabled) this.setHovering(false);
  }

  updateHover(): void {
    if (!this.pickingEnabled || this.isPointerDown) {
      this.setHovering(false);
      return;
    }
    const hit = this.intersect(this.pickTargets);
    this.setHovering(Boolean(hit));
  }

  private setHovering(hovering: boolean): void {
    if (hovering === this.wasHovering) return;
    this.wasHovering = hovering;
    this.onHoverChange?.(hovering);
    this.domElement.style.cursor = hovering ? 'pointer' : '';
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.isPointerDown = true;
    this.pointerDown.x = event.clientX;
    this.pointerDown.y = event.clientY;
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;
    if (!this.pickingEnabled || !this.onTap) return;

    const dx = event.clientX - this.pointerDown.x;
    const dy = event.clientY - this.pointerDown.y;
    if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;

    const hit = this.intersectAt(
      event.clientX,
      event.clientY,
      this.pickTargets,
    );
    if (!hit) return;
    const archiveId = hit.object.userData.archiveId as string | undefined;
    if (archiveId) this.onTap(archiveId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.pickingEnabled) return;
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!this.isPointerDown) {
      this.updateHover();
    }
  };

  private intersect(targets: THREE.Object3D[]): THREE.Intersection | null {
    if (targets.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits[0] ?? null;
  }

  private intersectAt(
    clientX: number,
    clientY: number,
    targets: THREE.Object3D[],
  ): THREE.Intersection | null {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.intersect(targets);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.style.cursor = '';
  }
}
