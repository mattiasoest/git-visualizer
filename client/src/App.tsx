import { useMemo, useState } from 'react';
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
  const { events, connectionStatus } = useEventStream();
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => new Set(FILTERABLE_TYPES));

  const eventCountsByType = useMemo(() => {
    const counts = Object.fromEntries(FILTERABLE_TYPES.map((type) => [type, 0]));
    for (const event of events) {
      if (event.type in counts) {
        counts[event.type] += 1;
      }
    }
    return counts;
  }, [events]);

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
      <header className="app-header">
        <div className="app-header__brand">
          <h1>GitHub Cosmos</h1>
          <p className="subtitle">Live public activity across the open-source universe</p>
        </div>
        <div className="filters" role="toolbar" aria-label="Event type filters">
          {FILTERABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`filter-chip ${activeTypes.has(type) ? 'active' : ''}`}
              style={{ '--chip-color': eventColor(type) } as React.CSSProperties}
              onClick={() => toggleType(type)}
            >
              {eventTypeLabel(type)}
            </button>
          ))}
        </div>
      </header>

      <main className="app-main">
        <SpaceVisualization events={events} activeTypes={activeTypes} />
      </main>

      <footer className="status-bar">
        <div className="status-bar__left">
          <span className={`status-dot ${connectionStatus}`} />
          <span>{statusLabel}</span>
          <span className="status-bar__total">
            <span className="status-bar__total-value">{events.length}</span>
            <span className="status-bar__total-label">Events</span>
          </span>
        </div>
        <span className="status-bar__type-counts" aria-label="Events by type">
          {FILTERABLE_TYPES.map((type) => (
            <span
              key={type}
              className="status-bar__type-count"
              style={{ '--type-color': eventColor(type) } as React.CSSProperties}
            >
              <span className="status-bar__type-label">{eventTypeLabel(type)}</span>
              <span className="status-bar__type-value">{eventCountsByType[type]}</span>
            </span>
          ))}
        </span>
      </footer>
    </div>
  );
}
