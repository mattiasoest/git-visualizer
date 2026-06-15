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
    activeEvents,
    viewMode,
    selectedArchive,
    selectGalaxy,
    exitDetail,
  } = useClusterArchives(events);

  const graphData = useStableGraphData(activeEvents);
  const { containerRef, sceneRef, sceneReady, autoRotating, labelsVisible, toggleLabels, resumeAutoRotate } =
    useSpaceScene(selectGalaxy);

  const { navTarget, setNavTarget } = useCosmosNavigation(archives.length);
  const archiveIds = useMemo(() => archives.map((archive) => archive.id), [archives]);
  const prevArchiveCount = useRef(archives.length);

  const navigateCamera = useCallback(
    (target: CosmosNavTarget) => {
      if (viewMode === 'detail') return;
      sceneRef.current?.navigateTo(target, archiveIds);
    },
    [archiveIds, sceneRef, viewMode],
  );

  const handleNavSelect = useCallback(
    (target: CosmosNavTarget) => {
      setNavTarget(target);
      navigateCamera(target);
    },
    [navigateCamera, setNavTarget],
  );

  const handleExitDetail = useCallback(() => {
    exitDetail();
    setNavTarget('global');
    sceneRef.current?.navigateTo('global', archiveIds);
  }, [exitDetail, setNavTarget, sceneRef, archiveIds]);

  const sceneInitialized = useRef(false);
  useEffect(() => {
    if (!sceneReady || viewMode !== 'overview') return;
    if (sceneInitialized.current) return;
    sceneInitialized.current = true;
    sceneRef.current?.navigateTo('global', archiveIds);
  }, [sceneReady, viewMode, sceneRef, archiveIds]);

  useEffect(() => {
    if (!sceneReady || viewMode !== 'overview') return;
    if (archives.length <= prevArchiveCount.current) return;
    prevArchiveCount.current = archives.length;
    setNavTarget('global');
    sceneRef.current?.navigateTo('global', archiveIds);
  }, [archives.length, archiveIds, sceneReady, viewMode, sceneRef, setNavTarget]);

  const galaxyArchives = useMemo(
    () => archives.map((archive) => ({ id: archive.id, eventCount: archive.events.length })),
    [archives],
  );

  const cosmos = useMemo(
    () => ({
      mode: viewMode,
      archives: galaxyArchives,
      detailGraphData: selectedArchive?.graphData,
    }),
    [viewMode, galaxyArchives, selectedArchive],
  );

  useSpaceEventSync(sceneRef, activeEvents, graphData, activeTypes, cosmos);

  return (
    <div className="space-visualization-shell">
      {viewMode === 'overview' && (
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
        {graphData.nodes.length === 0 && archives.length === 0 && <Placeholder />}
      </div>
    </div>
  );
}
