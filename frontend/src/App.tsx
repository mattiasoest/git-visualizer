import { useMemo, useState, forwardRef } from 'react';
import { AppHeader } from './components/AppHeader/AppHeader';
import { SpaceVisualization } from './components/SpaceVisualization/SpaceVisualization';
import { useEventStream } from './hooks/useEventStream';
import { useStatusBarTypeCountsFit } from './hooks/useStatusBarTypeCountsFit';
import { useViewportHeight } from './hooks/useViewportHeight';
import { FILTERABLE_TYPES, eventColor, eventTypeLabel } from './types/event';
import './App.css';

const StatusBarTypeCounts = forwardRef<
  HTMLSpanElement,
  {
    typeCounts: Record<string, number>;
    className?: string;
    'aria-hidden'?: boolean;
  }
>(function StatusBarTypeCounts(
  { typeCounts, className, 'aria-hidden': ariaHidden },
  ref,
) {
  return (
    <span
      ref={ref}
      className={className}
      aria-label={ariaHidden ? undefined : 'Events by type'}
      aria-hidden={ariaHidden}
    >
      {FILTERABLE_TYPES.map((type) => (
        <span
          key={type}
          className="status-bar__type-count"
          style={{ '--type-color': eventColor(type) } as React.CSSProperties}
        >
          <span className="status-bar__type-label">{eventTypeLabel(type)}</span>
          <span className="status-bar__type-value">{typeCounts[type]}</span>
        </span>
      ))}
    </span>
  );
});

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

  const typeCountsKey = FILTERABLE_TYPES.map((type) => typeCounts[type]).join(
    ',',
  );
  const {
    footerRef,
    leftRef,
    countsRef,
    measureRef,
    fitsOnOneLine,
    typeCountsWrapped,
  } = useStatusBarTypeCountsFit(typeCountsKey);

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

      <footer ref={footerRef} className="status-bar">
        <div ref={leftRef} className="status-bar__left">
          <span className={`status-dot ${connectionStatus}`} />
          <span>{statusLabel}</span>
          <span className="status-bar__total">
            <span className="status-bar__total-value">{totalReceived}</span>
            <span className="status-bar__total-label">Events</span>
          </span>
        </div>
        {fitsOnOneLine ? (
          <StatusBarTypeCounts
            ref={countsRef}
            typeCounts={typeCounts}
            className={`status-bar__type-counts${typeCountsWrapped ? ' status-bar__type-counts--wrapped' : ''}`}
          />
        ) : null}
      </footer>
      <div className="status-bar-probe" aria-hidden>
        <StatusBarTypeCounts
          ref={measureRef}
          typeCounts={typeCounts}
          className="status-bar__type-counts"
        />
      </div>
    </div>
  );
}
