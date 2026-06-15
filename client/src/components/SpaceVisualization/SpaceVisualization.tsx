import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EventView } from '../../types/event';
import { useClusterArchives } from '../../hooks/useClusterArchives';
import { useCosmosNavigation } from '../../hooks/useCosmosNavigation';
import { useSpaceEventSync } from '../../hooks/useSpaceEventSync';
import { useSpaceScene } from '../../hooks/useSpaceScene';
import { useStableGraphData } from '../../hooks/useStableGraphData';
import type { CosmosNavTarget } from '../../hooks/useCosmosNavigation';
import { Controls } from '../Controls/Controls';
import { CosmosNav } from '../CosmosNav/CosmosNav';
import { GalaxyBackButton } from '../GalaxyBackButton/GalaxyBackButton';
import { Placeholder } from '../Placeholder/Placeholder';
import './SpaceVisualization.css';

interface SpaceVisualizationProps {
  events: EventView[];
  activeTypes: Set<string>;
}

export function SpaceVisualization({ events, activeTypes }: SpaceVisualizationProps) {
  const {
    archives,
    pendingMerge,
    activeEvents,
    mergeDisplayGraph,
    viewMode,
    selectedArchive,
    selectGalaxy,
    exitDetail,
    completeMergeAnimation,
    isMergeAnimating,
  } = useClusterArchives(events);

  const graphData = useStableGraphData(activeEvents);
  const { containerRef, sceneRef, sceneReady, autoRotating, labelsVisible, toggleLabels, resumeAutoRotate } =
    useSpaceScene(selectGalaxy);

  const { navTarget, setNavTarget } = useCosmosNavigation(archives.length);
  const archiveIds = useMemo(() => archives.map((archive) => archive.id), [archives]);
  const prevArchiveCount = useRef(archives.length);
  const lastMergedGalaxyIdRef = useRef<string | null>(null);
  const navTargetAtMergeStartRef = useRef<CosmosNavTarget | null>(null);
  const prevPendingMergeRef = useRef(pendingMerge);

  useEffect(() => {
    if (pendingMerge && !prevPendingMergeRef.current) {
      navTargetAtMergeStartRef.current = navTarget;
      lastMergedGalaxyIdRef.current = pendingMerge.id;
    }
    prevPendingMergeRef.current = pendingMerge;
  }, [pendingMerge, navTarget]);

  useEffect(() => {
    if (viewMode !== 'overview' || isMergeAnimating) return;
    if (archives.length <= prevArchiveCount.current) return;

    const wasOnActiveCluster = navTargetAtMergeStartRef.current === 'active';
    navTargetAtMergeStartRef.current = null;

    const newGalaxyId =
      lastMergedGalaxyIdRef.current ?? archives[archives.length - 1]?.id ?? null;
    lastMergedGalaxyIdRef.current = null;
    prevArchiveCount.current = archives.length;

    if (wasOnActiveCluster && newGalaxyId) {
      setNavTarget(newGalaxyId);
    }
  }, [archives.length, viewMode, isMergeAnimating, setNavTarget, archives]);

  const navigateCamera = useCallback(
    (target: CosmosNavTarget) => {
      if (viewMode === 'detail' || isMergeAnimating) return;
      sceneRef.current?.navigateTo(target, archiveIds);
    },
    [archiveIds, sceneRef, viewMode, isMergeAnimating],
  );

  const handleNavSelect = useCallback(
    (target: CosmosNavTarget) => {
      if (isMergeAnimating) return;
      setNavTarget(target);
      navigateCamera(target);
    },
    [navigateCamera, setNavTarget, isMergeAnimating],
  );

  const handleExitDetail = useCallback(() => {
    exitDetail();
    setNavTarget('global');
    sceneRef.current?.navigateTo('global', archiveIds);
  }, [exitDetail, setNavTarget, sceneRef, archiveIds]);

  const sceneInitialized = useRef(false);
  useEffect(() => {
    if (!sceneReady || viewMode !== 'overview' || isMergeAnimating) return;
    if (sceneInitialized.current) return;
    sceneInitialized.current = true;
    sceneRef.current?.navigateTo('global', archiveIds);
  }, [sceneReady, viewMode, sceneRef, archiveIds, isMergeAnimating]);

  const galaxyArchives = useMemo(
    () => archives.map((archive) => ({ id: archive.id, eventCount: archive.events.length })),
    [archives],
  );

  const cosmos = useMemo(
    () => ({
      mode: viewMode,
      archives: galaxyArchives,
      detailGraphData: selectedArchive?.graphData,
      pendingMerge: pendingMerge
        ? { id: pendingMerge.id, eventCount: pendingMerge.events.length }
        : null,
      mergeDisplayGraph: mergeDisplayGraph,
      archiveCountBeforeMerge: archives.length,
      onMergeComplete: completeMergeAnimation,
    }),
    [
      viewMode,
      galaxyArchives,
      selectedArchive,
      pendingMerge,
      mergeDisplayGraph,
      archives.length,
      completeMergeAnimation,
    ],
  );

  useSpaceEventSync(sceneRef, activeEvents, graphData, activeTypes, cosmos);

  return (
    <div className="space-visualization-shell">
      {viewMode === 'overview' && !isMergeAnimating && (
        <CosmosNav archives={archives} navTarget={navTarget} onSelect={handleNavSelect} />
      )}
      <div ref={containerRef} className="space-visualization">
        <Controls
          labelsVisible={labelsVisible}
          autoRotating={autoRotating}
          onToggleLabels={toggleLabels}
          onResumeAutoRotate={resumeAutoRotate}
        />
        {viewMode === 'detail' && <GalaxyBackButton onBack={handleExitDetail} />}
        {graphData.nodes.length === 0 && archives.length === 0 && !isMergeAnimating && <Placeholder />}
      </div>
    </div>
  );
}
