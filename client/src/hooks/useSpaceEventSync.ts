import { useEffect, useRef, type RefObject } from 'react';
import type { EventView } from '../types/event';
import { eventColor } from '../types/event';
import type { GraphData } from '../space/utils/graphBuilder';
import type { SpaceScene } from '../space/SpaceScene';

export function useSpaceEventSync(
  sceneRef: RefObject<SpaceScene | null>,
  events: EventView[],
  graphData: GraphData,
  activeTypes: Set<string>,
) {
  const seenEventIds = useRef<Set<string>>(new Set());
  const activeTypesRef = useRef(activeTypes);
  activeTypesRef.current = activeTypes;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    scene.updateGraph(graphData);

    const currentActiveTypes = activeTypesRef.current;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
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

    if (seenEventIds.current.size > events.length * 2) {
      seenEventIds.current = new Set(events.map((event) => event.id));
    }
  }, [graphData, events, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setActiveEventTypes(activeTypes);
  }, [activeTypes, sceneRef]);
}
