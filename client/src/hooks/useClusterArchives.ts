import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function allocateGalaxyId(archives: ClusterArchive[], pending: ClusterArchive | null): string {
  const used = new Set<string>();
  for (const archive of archives) used.add(archive.id);
  if (pending) used.add(pending.id);
  let n = 1;
  while (used.has(`galaxy-${n}`)) n += 1;
  return `galaxy-${n}`;
}

export function useClusterArchives(allEvents: EventView[]) {
  const [archives, setArchives] = useState<ClusterArchive[]>([]);
  const [pendingMerge, setPendingMerge] = useState<ClusterArchive | null>(null);
  const [viewMode, setViewMode] = useState<CosmosViewMode>('overview');
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const mergeCompletedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (pendingMerge) return;

    const archivedIds = new Set(archives.flatMap((archive) => archive.events.map((event) => event.id)));
    const active = allEvents.filter((event) => !archivedIds.has(event.id));
    if (active.length < MERGE_EVENT_THRESHOLD) return;

    const toArchive = active.slice(0, MERGE_EVENT_THRESHOLD);
    const id = allocateGalaxyId(archives, null);
    setPendingMerge({
      id,
      events: toArchive,
      graphData: buildGraph(toArchive),
      mergedAt: Date.now(),
    });
  }, [allEvents, archives, pendingMerge]);

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
    () => new Set(archives.flatMap((archive) => archive.events.map((event) => event.id))),
    [archives],
  );

  const pendingEventIds = useMemo(
    () => new Set(pendingMerge?.events.map((event) => event.id) ?? []),
    [pendingMerge],
  );

  const activeEvents = useMemo(
    () =>
      allEvents.filter(
        (event) => !archivedEventIds.has(event.id) && !pendingEventIds.has(event.id),
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

  const selectGalaxy = useCallback((archiveId: string) => {
    if (pendingMerge) return;
    setSelectedArchiveId(archiveId);
    setViewMode('detail');
  }, [pendingMerge]);

  const exitDetail = useCallback(() => {
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
    completeMergeAnimation,
    isMergeAnimating: pendingMerge !== null,
  };
}
