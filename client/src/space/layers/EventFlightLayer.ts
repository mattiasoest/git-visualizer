import * as THREE from 'three';
import {
  EVENT_PARTICLE_SIZE,
  FLIGHT_DURATION_MS,
  FLIGHT_IMPACT_PULSE_MS,
  MAX_ACTIVE_FLIGHTS,
  REPO_SPAWN_MS,
} from '../utils/constants';
import { eventNodeId } from '../utils/graphBuilder';
import type { EventFlight, EventFlightPayload, QueuedFlight } from '../utils/types';
import type { EventParticleLayer } from './EventParticleLayer';
import type { GraphNodeLayer } from './GraphNodeLayer';

export class EventFlightLayer {
  readonly group = new THREE.Group();
  private flights: EventFlight[] = [];
  private flightQueue: QueuedFlight[] = [];
  private flightPosition = new THREE.Vector3();
  private flightScratch = new THREE.Vector3();

  constructor(
    private nodes: GraphNodeLayer,
    private eventParticles: EventParticleLayer,
    private pointSprite: THREE.Texture,
  ) {}

  enqueue(payload: EventFlightPayload): void {
    const targetId = eventNodeId(payload.eventId);
    if (this.eventParticles.isSuppressed(targetId)) {
      this.nodes.instantRevealEvent(payload.eventId);
      return;
    }
    this.flightQueue.push({ ...payload });
    this.processQueue();
  }

  processQueue(): void {
    if (this.flightQueue.length === 0) return;

    const now = performance.now();
    let writeIndex = 0;

    for (let i = 0; i < this.flightQueue.length; i++) {
      const next = this.flightQueue[i]!;
      const targetId = eventNodeId(next.eventId);
      const target = this.nodes.getNodeState(targetId);
      const repo = this.nodes.getNodeState(next.repoId);

      if (!target || !repo) {
        this.flightQueue[writeIndex++] = next;
        continue;
      }

      if (this.nodes.isSpawnDeferred(repo)) {
        this.nodes.beginNodeSpawn(repo);
      }

      if (this.nodes.isNodeSpawning(repo, REPO_SPAWN_MS, now)) {
        this.flightQueue[writeIndex++] = next;
        continue;
      }

      if (!this.launchFlight(next)) {
        this.flightQueue[writeIndex++] = next;
        continue;
      }
    }

    this.flightQueue.length = writeIndex;
  }

  update(now: number): void {
    let writeIndex = 0;

    for (let i = 0; i < this.flights.length; i++) {
      const flight = this.flights[i]!;
      this.refreshFlightCurve(flight);
      const elapsed = now - flight.startTime;
      const t = Math.min(elapsed / FLIGHT_DURATION_MS, 1);
      const eased = t * t;

      const oneMinusT = 1 - eased;
      const omt2 = oneMinusT * oneMinusT;
      const e2 = eased * eased;
      const pos = this.flightPosition;
      pos.x = omt2 * flight.from.x + 2 * oneMinusT * eased * flight.mid.x + e2 * flight.to.x;
      pos.y = omt2 * flight.from.y + 2 * oneMinusT * eased * flight.mid.y + e2 * flight.to.y;
      pos.z = omt2 * flight.from.z + 2 * oneMinusT * eased * flight.mid.z + e2 * flight.to.z;

      const size = flight.startSize + (flight.endSize - flight.startSize) * eased;
      const positionAttr = flight.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = positionAttr.array as Float32Array;
      arr[0] = pos.x;
      arr[1] = pos.y;
      arr[2] = pos.z;
      positionAttr.needsUpdate = true;
      (flight.points.material as THREE.PointsMaterial).size = size;

      if (t < 1) {
        this.flights[writeIndex++] = flight;
      } else {
        const target = this.nodes.getNodeState(flight.targetId);
        if (target?.node.kind === 'event' && this.nodes.isSpawnDeferred(target)) {
          this.eventParticles.setWorldPosition(flight.targetId, flight.to);
          this.nodes.revealEventNode(target);
        }
        this.nodes.markEventSpawned(flight.targetId);
        const impactUntil = performance.now() + FLIGHT_IMPACT_PULSE_MS;
        this.eventParticles.setPulseUntil(flight.targetId, impactUntil);
        if (target) target.pulseUntil = impactUntil;
        this.disposeFlight(flight);
      }
    }

    this.flights.length = writeIndex;
  }

  clear(): void {
    for (const flight of this.flights) {
      this.disposeFlight(flight);
    }
    this.flights.length = 0;
    this.flightQueue.length = 0;
  }

  dispose(): void {
    this.clear();
  }

  private launchFlight(payload: QueuedFlight): boolean {
    if (this.flights.length >= MAX_ACTIVE_FLIGHTS) return false;

    const targetId = eventNodeId(payload.eventId);
    const repo = this.nodes.getNodeState(payload.repoId);
    const targetPos = this.nodes.getNodePosition(targetId);
    if (!repo || !targetPos) return false;

    const to = targetPos.clone();
    const repoPos = repo.position.clone();
    this.flightScratch.copy(to).sub(repoPos);
    if (this.flightScratch.lengthSq() < 0.001) {
      this.flightScratch.set(0, 1, 0);
    } else {
      this.flightScratch.normalize();
    }
    const from = repoPos.clone().addScaledVector(this.flightScratch, repo.baseRadius * 1.15);
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y += from.distanceTo(to) * 0.08;

    const sizeScale = this.eventParticles.getSizeScale(targetId);
    const particleSize = EVENT_PARTICLE_SIZE * sizeScale;

    const positions = new Float32Array([from.x, from.y, from.z]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: particleSize,
      map: this.pointSprite,
      color: new THREE.Color(payload.eventColor),
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
      depthWrite: false,
      alphaTest: 0.01,
    });
    const points = new THREE.Points(geometry, material);
    this.group.add(points);

    this.flights.push({
      points,
      targetId,
      from,
      to,
      mid,
      startSize: particleSize * 0.85,
      endSize: particleSize,
      startTime: performance.now(),
    });

    return true;
  }

  private refreshFlightCurve(flight: EventFlight): void {
    const liveTarget = this.nodes.getNodePosition(flight.targetId);
    if (!liveTarget) return;
    flight.to.copy(liveTarget);
    flight.mid.lerpVectors(flight.from, flight.to, 0.5);
    flight.mid.y += flight.from.distanceTo(flight.to) * 0.08;
  }

  private disposeFlight(flight: EventFlight): void {
    this.group.remove(flight.points);
    flight.points.geometry.dispose();
    (flight.points.material as THREE.Material).dispose();
  }
}
