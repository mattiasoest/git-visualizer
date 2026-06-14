import type { EventView } from '../../types/event';
import { useSpaceEventSync } from '../../hooks/useSpaceEventSync';
import { useSpaceScene } from '../../hooks/useSpaceScene';
import { useStableGraphData } from '../../hooks/useStableGraphData';
import { Controls } from '../Controls/Controls';
import { Placeholder } from '../Placeholder/Placeholder';
import './SpaceVisualization.css';

interface SpaceVisualizationProps {
  events: EventView[];
  activeTypes: Set<string>;
}

export function SpaceVisualization({ events, activeTypes }: SpaceVisualizationProps) {
  const graphData = useStableGraphData(events);
  const {
    containerRef,
    sceneRef,
    autoRotating,
    labelsVisible,
    toggleLabels,
    resumeAutoRotate,
  } = useSpaceScene();

  useSpaceEventSync(sceneRef, events, graphData, activeTypes);

  return (
    <div ref={containerRef} className="space-visualization">
      <Controls
        labelsVisible={labelsVisible}
        autoRotating={autoRotating}
        onToggleLabels={toggleLabels}
        onResumeAutoRotate={resumeAutoRotate}
      />
      {graphData.nodes.length === 0 && <Placeholder />}
    </div>
  );
}
