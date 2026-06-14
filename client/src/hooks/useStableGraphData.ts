import { useMemo, useRef } from 'react';
import type { EventView } from '../types/event';
import {
  buildGraph,
  graphDataFingerprint,
  type GraphData,
} from '../space/utils/graphBuilder';

export function useStableGraphData(events: EventView[]): GraphData {
  const graphDataRef = useRef<GraphData>({ nodes: [], links: [] });
  const fingerprintRef = useRef('');

  return useMemo(() => {
    const next = buildGraph(events);
    const fingerprint = graphDataFingerprint(next);
    if (fingerprint === fingerprintRef.current) {
      return graphDataRef.current;
    }
    fingerprintRef.current = fingerprint;
    graphDataRef.current = next;
    return next;
  }, [events]);
}
