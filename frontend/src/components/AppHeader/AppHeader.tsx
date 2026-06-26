import { FILTERABLE_TYPES, eventColor } from '../../types/event';
import './AppHeader.css';

function eventTypeLabel(type: string): string {
  return type.replace('Event', '');
}

function OrbitalMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        className="app-header__mark-ring app-header__mark-ring--outer"
        cx="22"
        cy="22"
        r="18"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeOpacity="0.35"
      />
      <circle
        className="app-header__mark-ring app-header__mark-ring--inner"
        cx="22"
        cy="22"
        r="11"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.55"
      />
      <circle
        className="app-header__mark-node"
        cx="22"
        cy="22"
        r="3.5"
        fill="currentColor"
      />
      <circle
        className="app-header__mark-orbit-dot"
        cx="22"
        cy="4"
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}

interface AppHeaderProps {
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
}

export function AppHeader({ activeTypes, onToggleType }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div
        className="app-header__brand"
        aria-label="GitHub Cosmos — live public event stream"
      >
        <div className="app-header__identity">
          <OrbitalMark className="app-header__mark" />
          <h1 className="app-header__title">
            <span className="app-header__title-github">GitHub</span>{' '}
            <span className="app-header__title-cosmos">Cosmos</span>
          </h1>
        </div>
        <div className="app-header__tagline">
          <p>Public open-source activity, streaming in real time</p>
        </div>
      </div>
      <div className="filters" role="toolbar" aria-label="Event type filters">
        {FILTERABLE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`filter-chip ${activeTypes.has(type) ? 'active' : ''}`}
            style={{ '--chip-color': eventColor(type) } as React.CSSProperties}
            onClick={() => onToggleType(type)}
          >
            {eventTypeLabel(type)}
          </button>
        ))}
      </div>
    </header>
  );
}
