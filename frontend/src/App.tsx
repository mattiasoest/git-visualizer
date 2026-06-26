import { useMemo, useState } from 'react';
import { AppHeader } from './components/AppHeader/AppHeader';
import { SpaceVisualization } from './components/SpaceVisualization/SpaceVisualization';
import { useEventStream } from './hooks/useEventStream';
import { useViewportHeight } from './hooks/useViewportHeight';
import { FILTERABLE_TYPES, eventColor } from './types/event';
import './App.css';

function eventTypeLabel(type: string): string {
  return type.replace('Event', '');
}

export default function App() {
  useViewportHeight();
  const { events, totalReceived, typeCounts, connectionStatus, pruneEvents } =
    useEventStream();
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    () => new Set(FILTERABLE_TYPES),
  );

  const toggleType = (type: string) => {
    setActiveTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const statusLabel = useMemo(() => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting';
      case 'reconnecting':
        return 'Reconnecting';
      default:
        return 'Disconnected';
    }
  }, [connectionStatus]);

  return (
    <div className="app">
      <AppHeader activeTypes={activeTypes} onToggleType={toggleType} />

      <main className="app-main">
        <SpaceVisualization
          events={events}
          activeTypes={activeTypes}
          onEventsArchived={pruneEvents}
        />
      </main>

      <footer className="status-bar">
        <div className="status-bar__left">
          <span className={`status-dot ${connectionStatus}`} />
          <span>{statusLabel}</span>
          <span className="status-bar__total">
            <span className="status-bar__total-value">{totalReceived}</span>
            <span className="status-bar__total-label">Events</span>
          </span>
        </div>
        <span className="status-bar__type-counts" aria-label="Events by type">
          {FILTERABLE_TYPES.map((type) => (
            <span
              key={type}
              className="status-bar__type-count"
              style={
                { '--type-color': eventColor(type) } as React.CSSProperties
              }
            >
              <span className="status-bar__type-label">
                {eventTypeLabel(type)}
              </span>
              <span className="status-bar__type-value">{typeCounts[type]}</span>
            </span>
          ))}
        </span>
      </footer>
    </div>
  );
}
