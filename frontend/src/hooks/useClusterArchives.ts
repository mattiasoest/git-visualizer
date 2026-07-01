import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventView } from '../types/event';
import { buildGraph, type GraphData } from '../space/utils/graphBuilder';
import {
  MAX_GALAXY_ARCHIVES,
  MERGE_EVENT_THRESHOLD,
} from '../space/utils/constants';

export type CosmosViewMode = 'overview' | 'detail';

export interface ClusterArchive {
  id: string;
  eventCount: number;
  eventIds: string[];
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

export function useClusterArchives(
  allEvents: EventView[],
  onEventsArchived?: (eventIds: string[]) => void,
) {
  const [archives, setArchives] = useState<ClusterArchive[]>([]);
  const [pendingMerge, setPendingMerge] = useState<ClusterArchive | null>(null);
  const [viewMode, setViewMode] = useState<CosmosViewMode>('overview');
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(
    null,
  );
  const [isPreparingDetail, setIsPreparingDetail] = useState(false);
  const mergeCompletedIds = useRef<Set<string>>(new Set());
  const pruneAfterMergeRef = useRef<string[] | null>(null);
  const onEventsArchivedRef = useRef(onEventsArchived);
  onEventsArchivedRef.current = onEventsArchived;

  const completeMergeAnimation = useCallback(() => {
    setPendingMerge((pending) => {
      if (!pending) return null;
      if (mergeCompletedIds.current.has(pending.id)) return null;
      mergeCompletedIds.current.add(pending.id);
      pruneAfterMergeRef.current = pending.eventIds;

      setArchives((prev) => {
        if (prev.some((archive) => archive.id === pending.id)) return prev;
        const next = [...prev, pending];
        if (next.length <= MAX_GALAXY_ARCHIVES) return next;
        return next.slice(next.length - MAX_GALAXY_ARCHIVES);
      });
      return null;
    });
  }, []);

  useEffect(() => {
    const eventIds = pruneAfterMergeRef.current;
    if (!eventIds) return;
    pruneAfterMergeRef.current = null;
    onEventsArchivedRef.current?.(eventIds);
  }, [pendingMerge, archives]);

  const archivedEventIds = useMemo(
    () => new Set(archives.flatMap((archive) => archive.eventIds)),
    [archives],
  );

  const pendingEventIds = useMemo(
    () => new Set(pendingMerge?.eventIds ?? []),
    [pendingMerge],
  );

  useEffect(() => {
    if (pendingMerge) return;

    const active = allEvents.filter((event) => !archivedEventIds.has(event.id));
    if (active.length < MERGE_EVENT_THRESHOLD) return;

    const toArchive = active.slice(0, MERGE_EVENT_THRESHOLD);
    const id = allocateGalaxyId(archives, null);
    setPendingMerge({
      id,
      eventCount: toArchive.length,
      eventIds: toArchive.map((event) => event.id),
      graphData: buildGraph(toArchive),
      mergedAt: Date.now(),
    });
  }, [allEvents, archives, archivedEventIds, pendingMerge]);

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

  useEffect(() => {
    if (!selectedArchiveId) return;
    if (archives.some((archive) => archive.id === selectedArchiveId)) return;
    exitDetail();
  }, [archives, selectedArchiveId, exitDetail]);

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
