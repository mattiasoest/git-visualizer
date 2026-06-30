import { useEffect, useRef, type RefObject } from 'react';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import type { GraphData } from '../space/utils/graphBuilder';
import type {
  CosmosViewMode,
  GalaxyArchiveRef,
  SpaceScene,
} from '../space/SpaceScene';

interface PendingMergeRef {
  id: string;
  eventCount: number;
}

interface CosmosSyncInput {
  mode: CosmosViewMode;
  archives: GalaxyArchiveRef[];
  detailGraphData?: GraphData;
  pendingMerge: PendingMergeRef | null;
  mergeDisplayGraph: GraphData | null;
  archiveCountBeforeMerge: number;
  onMergeComplete: () => void;
  onDetailLayoutReady?: () => void;
  skipAnimations?: boolean;
}

export function useSpaceEventSync(
  sceneRef: RefObject<SpaceScene | null>,
  activeEvents: EventView[],
  graphData: GraphData,
  activeTypes: Set<string>,
  cosmos: CosmosSyncInput,
) {
  const seenEventIds = useRef<Set<string>>(new Set());
  const activeTypesRef = useRef(activeTypes);
  const cosmosRef = useRef(cosmos);
  const mergeStartedIdRef = useRef<string | null>(null);
  activeTypesRef.current = activeTypes;
  cosmosRef.current = cosmos;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || scene.isMergeAnimating()) return;
    if (cosmosRef.current.pendingMerge) return;

    const { mode, archives, detailGraphData, onDetailLayoutReady } =
      cosmosRef.current;

    const applyLayout = () => {
      scene.setCosmosLayout({
        mode,
        archives,
        activeGraphData: graphData,
        detailGraphData,
      });
      if (mode === 'detail' && detailGraphData) {
        onDetailLayoutReady?.();
      }
    };

    if (mode === 'detail' && detailGraphData) {
      let innerRaf = 0;
      const outerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(applyLayout);
      });
      return () => {
        cancelAnimationFrame(outerRaf);
        if (innerRaf) cancelAnimationFrame(innerRaf);
      };
    }

    applyLayout();
  }, [
    graphData,
    cosmos.mode,
    cosmos.archives,
    cosmos.detailGraphData,
    cosmos.pendingMerge,
    sceneRef,
  ]);

  const mergeCompletedRef = useRef(false);

  useEffect(() => {
    if (!cosmos.skipAnimations) return;
    sceneRef.current?.skipMergeAnimation();
  }, [cosmos.skipAnimations, sceneRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    const pending = cosmosRef.current.pendingMerge;
    if (!scene || !pending || !cosmosRef.current.mergeDisplayGraph) return;
    if (mergeStartedIdRef.current === pending.id) return;

    mergeCompletedRef.current = false;
    mergeStartedIdRef.current = pending.id;

    const onComplete = () => {
      if (mergeCompletedRef.current) return;
      mergeCompletedRef.current = true;
      mergeStartedIdRef.current = null;
      cosmosRef.current.onMergeComplete();
    };

    const archive = { id: pending.id, eventCount: pending.eventCount };
    const archiveIndex = cosmosRef.current.archiveCountBeforeMerge;

    if (cosmosRef.current.skipAnimations) {
      scene.updateGraph(graphData);
      scene.instantRevealActiveCluster();
      scene.instantCompleteMerge(archive, archiveIndex, onComplete);
      return;
    }

    scene.loadMergeGraph(cosmosRef.current.mergeDisplayGraph);
    scene.startMergeAnimation(archive, archiveIndex, onComplete);
  }, [
    graphData,
    cosmos.pendingMerge,
    cosmos.mergeDisplayGraph,
    cosmos.archiveCountBeforeMerge,
    cosmos.onMergeComplete,
    cosmos.skipAnimations,
    sceneRef,
  ]);

  const prevModeRef = useRef(cosmos.mode);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (prevModeRef.current === 'detail' && cosmos.mode === 'overview') {
      scene.instantRevealActiveCluster();
    }
    prevModeRef.current = cosmos.mode;
  }, [cosmos.mode, cosmos.archives.length, sceneRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.isMergeAnimating() || cosmosRef.current.pendingMerge) return;

    if (cosmosRef.current.mode === 'detail') {
      scene.syncEventTypeFilterVisibility();
      return;
    }

    scene.updateGraph(graphData);

    if (cosmosRef.current.skipAnimations) {
      scene.clearEventFlights();
      scene.instantRevealActiveCluster();
      seenEventIds.current = new Set(activeEvents.map((event) => event.id));
      scene.syncEventTypeFilterVisibility();
      return;
    }

    const currentActiveTypes = activeTypesRef.current;
    for (
      let eventIndex = activeEvents.length - 1;
      eventIndex >= 0;
      eventIndex--
    ) {
      const event = activeEvents[eventIndex]!;
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);

      const actorLogin = event.actor?.login;
      const repoName = event.repo?.name;
      if (!actorLogin || !repoName) continue;

      if (!currentActiveTypes.has(event.type)) {
        scene.instantRevealEvent(event.id);
        continue;
      }

      scene.enqueueEventFlight({
        eventId: event.id,
        repoId: `repo:${repoName}`,
        eventColor: eventColor(event.type),
      });
    }

    scene.syncEventTypeFilterVisibility();

    if (seenEventIds.current.size > activeEvents.length * 2) {
      seenEventIds.current = new Set(activeEvents.map((event) => event.id));
    }
  }, [
    graphData,
    activeEvents,
    sceneRef,
    cosmos.mode,
    cosmos.pendingMerge,
    cosmos.skipAnimations,
  ]);

  useEffect(() => {
    sceneRef.current?.setActiveEventTypes(activeTypes);
  }, [activeTypes, sceneRef]);
}
