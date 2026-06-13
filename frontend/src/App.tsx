import { useMemo, useState } from 'react';
import { ActivityGraph } from './components/ActivityGraph';
import { useEventStream } from './hooks/useEventStream';
import { FILTERABLE_TYPES, eventColor } from './types/event';
import './App.css';

function formatPollTime(iso: string | null): string {
  if (!iso) return 'pending';
  return new Date(iso).toLocaleTimeString();
}

export default function App() {
  const { events, connectionStatus, lastPollAt } = useEventStream();
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => new Set(FILTERABLE_TYPES));

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
        <div>
          <h1>GitHub Events Visualizer</h1>
          <p className="subtitle">Global public activity feed</p>
        </div>
        <div className="filters">
          {FILTERABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`filter-chip ${activeTypes.has(type) ? 'active' : ''}`}
              style={{ '--chip-color': eventColor(type) } as React.CSSProperties}
              onClick={() => toggleType(type)}
            >
              {type.replace('Event', '')}
            </button>
          ))}
        </div>
      </header>

      <main className="app-main">
        <ActivityGraph events={events} activeTypes={activeTypes} />
      </main>

      <footer className="status-bar">
        <span className={`status-dot ${connectionStatus}`} />
        <span>{statusLabel}</span>
        <span>{events.length} events</span>
        <span>Last GitHub poll: {formatPollTime(lastPollAt)}</span>
        <span className="disclaimer">Data from GitHub public feed; updates every ~60s</span>
      </footer>
    </div>
  );
}
