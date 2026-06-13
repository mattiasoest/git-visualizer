import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, EventView, EventsSnapshotResponse } from '../types/event';

const MAX_EVENTS = 300;

function mergeEvents(existing: EventView[], incoming: EventView[]): EventView[] {
  const map = new Map<string, EventView>();
  for (const event of incoming) {
    map.set(event.id, event);
  }
  for (const event of existing) {
    if (!map.has(event.id)) {
      map.set(event.id, event);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_EVENTS);
}

export function useEventStream() {
  const [events, setEvents] = useState<EventView[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<EventView[]>([]);
  const flushScheduledRef = useRef(false);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    startTransition(() => {
      setEvents((current) => mergeEvents(current, batch));
    });
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

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus((status) => (status === 'connected' ? 'reconnecting' : 'connecting'));

    const source = new EventSource('/api/stream/events?replay=50');
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
    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await fetch('/api/events?limit=50');
        if (!response.ok) {
          throw new Error(`Bootstrap failed: ${response.status}`);
        }
        const data = (await response.json()) as EventsSnapshotResponse;
        if (!cancelled) {
          setEvents(data.events);
          setLastPollAt(data.lastPollAt);
        }
      } catch (error) {
        console.error('Failed to bootstrap events', error);
      }
    }

    bootstrap();
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    };
  }, [connect]);

  return { events, connectionStatus, lastPollAt };
}
