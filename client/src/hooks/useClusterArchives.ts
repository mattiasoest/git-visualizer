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

export function useClusterArchives(allEvents: EventView[]) {
  const [archives, setArchives] = useState<ClusterArchive[]>([]);
  const [viewMode, setViewMode] = useState<CosmosViewMode>('overview');
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const nextArchiveId = useRef(1);

  useEffect(() => {
    setArchives((prev) => {
      const archivedIds = new Set(prev.flatMap((archive) => archive.events.map((event) => event.id)));
      let active = allEvents.filter((event) => !archivedIds.has(event.id));
      let updated = prev;
      let changed = false;

      while (active.length >= MERGE_EVENT_THRESHOLD) {
        const toArchive = active.slice(0, MERGE_EVENT_THRESHOLD);
        active = active.slice(MERGE_EVENT_THRESHOLD);
        const archive: ClusterArchive = {
          id: `galaxy-${nextArchiveId.current++}`,
          events: toArchive,
          graphData: buildGraph(toArchive),
          mergedAt: Date.now(),
        };
        updated = changed ? [...updated, archive] : [...prev, archive];
        changed = true;
      }

      return changed ? updated : prev;
    });
  }, [allEvents]);

  const archivedEventIds = useMemo(
    () => new Set(archives.flatMap((archive) => archive.events.map((event) => event.id))),
    [archives],
  );

  const activeEvents = useMemo(
    () => allEvents.filter((event) => !archivedEventIds.has(event.id)),
    [allEvents, archivedEventIds],
  );

  const selectedArchive = useMemo(
    () => archives.find((archive) => archive.id === selectedArchiveId) ?? null,
    [archives, selectedArchiveId],
  );

  const selectGalaxy = useCallback((archiveId: string) => {
    setSelectedArchiveId(archiveId);
    setViewMode('detail');
  }, []);

  const exitDetail = useCallback(() => {
    setViewMode('overview');
    setSelectedArchiveId(null);
  }, []);

  return {
    archives,
    activeEvents,
    viewMode,
    selectedArchiveId,
    selectedArchive,
    selectGalaxy,
    exitDetail,
  };
}
