import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ConnectionStatus, EventView } from '../types/event';
import { FILTERABLE_TYPES } from '../types/event';
import { MAX_STREAM_EVENTS } from '../space/utils/constants';
import { apiUrl } from '../utils/apiBase';

function emptyTypeCounts(): Record<string, number> {
  return Object.fromEntries(FILTERABLE_TYPES.map((type) => [type, 0]));
}

function mergeEvents(
  existing: EventView[],
  incoming: EventView[],
): EventView[] {
  const map = new Map<string, EventView>();
  for (const event of incoming) {
    map.set(event.id, event);
  }
  for (const event of existing) {
    if (!map.has(event.id)) {
      map.set(event.id, event);
    }
  }
  return Array.from(map.values()).sort(
    (leftEvent, rightEvent) =>
      new Date(rightEvent.createdAt).getTime() -
      new Date(leftEvent.createdAt).getTime(),
  );
}

function capEvents(events: EventView[]): EventView[] {
  if (events.length <= MAX_STREAM_EVENTS) return events;
  return events.slice(0, MAX_STREAM_EVENTS);
}

function syncKnownIds(knownIds: Set<string>, events: EventView[]): void {
  const activeIds = new Set(events.map((event) => event.id));
  for (const id of knownIds) {
    if (!activeIds.has(id)) {
      knownIds.delete(id);
    }
  }
}

function countEventsByType(events: EventView[]): Record<string, number> {
  const counts = emptyTypeCounts();
  for (const event of events) {
    if (event.type in counts) {
      counts[event.type] += 1;
    }
  }
  return counts;
}

export function useEventStream() {
  const [events, setEvents] = useState<EventView[]>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [typeCounts, setTypeCounts] =
    useState<Record<string, number>>(emptyTypeCounts);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<EventView[]>([]);
  const flushScheduledRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    let newCount = 0;
    const typeIncrements = emptyTypeCounts();
    for (const event of batch) {
      if (!knownIdsRef.current.has(event.id)) {
        knownIdsRef.current.add(event.id);
        newCount += 1;
        if (event.type in typeIncrements) {
          typeIncrements[event.type] += 1;
        }
      }
    }
    if (newCount > 0) {
      setTotalReceived((count) => count + newCount);
      setTypeCounts((counts) => {
        const next = { ...counts };
        for (const type of FILTERABLE_TYPES) {
          next[type] += typeIncrements[type];
        }
        return next;
      });
    }
    let cappedForTypeSync: EventView[] | null = null;
    startTransition(() => {
      setEvents((current) => {
        const merged = mergeEvents(current, batch);
        const next = capEvents(merged);
        syncKnownIds(knownIdsRef.current, next);
        if (next.length < merged.length) {
          cappedForTypeSync = next;
        }
        return next;
      });
    });
    if (cappedForTypeSync) {
      queueMicrotask(() =>
        setTypeCounts(countEventsByType(cappedForTypeSync!)),
      );
    }
  }, []);

  const handleIncoming = useCallback(
    (event: EventView) => {
      pendingRef.current.push(event);
      if (flushScheduledRef.current) return;
      flushScheduledRef.current = true;
      queueMicrotask(() => {
        flushScheduledRef.current = false;
        flushPending();
      });
    },
    [flushPending],
  );

  const pruneEvents = useCallback((eventIds: Iterable<string>) => {
    const removeIds = new Set(eventIds);
    if (removeIds.size === 0) return;

    for (const id of removeIds) {
      knownIdsRef.current.delete(id);
    }

    startTransition(() => {
      setEvents((current) => {
        const next = current.filter((event) => !removeIds.has(event.id));
        if (next.length === current.length) return current;
        queueMicrotask(() => setTypeCounts(countEventsByType(next)));
        return next;
      });
    });
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus((status) =>
      status === 'connected' ? 'reconnecting' : 'connecting',
    );

    const source = new EventSource(apiUrl('/stream/events'));
    eventSourceRef.current = source;

    source.addEventListener('github-event', (message) => {
      const event = JSON.parse(message.data) as EventView;
      handleIncoming(event);
    });

    source.onopen = () => {
      setConnectionStatus('connected');
    };

    source.onerror = () => {
      setConnectionStatus('reconnecting');
      source.close();
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(connect, 3000);
    };
  }, [handleIncoming]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    };
  }, [connect]);

  return { events, totalReceived, typeCounts, connectionStatus, pruneEvents };
}
