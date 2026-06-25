import { useCallback, useMemo, useRef, useState } from 'react';
import type { EventView } from '../types/event';
import { buildGraph, type GraphData } from '../space/utils/graphBuilder';
import { MERGE_EVENT_THRESHOLD } from '../space/utils/constants';

export type CosmosViewMode = 'overview' | 'detail';

export interface ClusterArchive {
  id: string;
  events: EventView[];
  graphData: GraphData;
  mergedAt: number;
}

function allocateGalaxyId(
  archives: ClusterArchive[],
  pending: ClusterArchive | null,
): string {
  const used = new Set<string>();
  for (const archive of archives) used.add(archive.id);
  if (pending) used.add(pending.id);
  let galaxyNumber = 1;
  while (used.has(`galaxy-${galaxyNumber}`)) galaxyNumber += 1;
  return `galaxy-${galaxyNumber}`;
}

export function useClusterArchives(allEvents: EventView[]) {
  const [archives, setArchives] = useState<ClusterArchive[]>([]);
  const [pendingMerge, setPendingMerge] = useState<ClusterArchive | null>(null);
  const [viewMode, setViewMode] = useState<CosmosViewMode>('overview');
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(
    null,
  );
  const [isPreparingDetail, setIsPreparingDetail] = useState(false);
  const mergeCompletedIds = useRef<Set<string>>(new Set());

  const completeMergeAnimation = useCallback(() => {
    setPendingMerge((pending) => {
      if (!pending) return null;
      if (mergeCompletedIds.current.has(pending.id)) return null;
      mergeCompletedIds.current.add(pending.id);

      setArchives((prev) => {
        if (prev.some((archive) => archive.id === pending.id)) return prev;
        return [...prev, pending];
      });
      return null;
    });
  }, []);

  const archivedEventIds = useMemo(
    () =>
      new Set(
        archives.flatMap((archive) => archive.events.map((event) => event.id)),
      ),
    [archives],
  );

  const pendingEventIds = useMemo(
    () => new Set(pendingMerge?.events.map((event) => event.id) ?? []),
    [pendingMerge],
  );

  if (!pendingMerge) {
    const active = allEvents.filter((event) => !archivedEventIds.has(event.id));
    if (active.length >= MERGE_EVENT_THRESHOLD) {
      const toArchive = active.slice(0, MERGE_EVENT_THRESHOLD);
      const id = allocateGalaxyId(archives, null);
      setPendingMerge({
        id,
        events: toArchive,
        graphData: buildGraph(toArchive),
        mergedAt: Date.now(),
      });
    }
  }

  const activeEvents = useMemo(
    () =>
      allEvents.filter(
        (event) =>
          !archivedEventIds.has(event.id) && !pendingEventIds.has(event.id),
      ),
    [allEvents, archivedEventIds, pendingEventIds],
  );

  const mergeDisplayGraph = useMemo(
    () => pendingMerge?.graphData ?? null,
    [pendingMerge],
  );

  const selectedArchive = useMemo(
    () => archives.find((archive) => archive.id === selectedArchiveId) ?? null,
    [archives, selectedArchiveId],
  );

  const selectGalaxy = useCallback(
    (archiveId: string) => {
      if (pendingMerge) return;
      setIsPreparingDetail(true);
      setSelectedArchiveId(archiveId);
      setViewMode('detail');
    },
    [pendingMerge],
  );

  const completeDetailPrepare = useCallback(() => {
    setIsPreparingDetail(false);
  }, []);

  const exitDetail = useCallback(() => {
    setIsPreparingDetail(false);
    setViewMode('overview');
    setSelectedArchiveId(null);
  }, []);

  return {
    archives,
    pendingMerge,
    activeEvents,
    mergeDisplayGraph,
    viewMode,
    selectedArchiveId,
    selectedArchive,
    selectGalaxy,
    exitDetail,
    completeDetailPrepare,
    completeMergeAnimation,
    isPreparingDetail,
    isMergeAnimating: pendingMerge !== null,
  };
}
