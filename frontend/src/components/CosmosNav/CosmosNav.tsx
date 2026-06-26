import type { CosmosNavTarget } from '../../hooks/useCosmosNavigation';
import './CosmosNav.css';

interface CosmosNavProps {
  archives: { id: string }[];
  navTarget: CosmosNavTarget;
  onSelect: (target: CosmosNavTarget) => void;
}

export function CosmosNav({ archives, navTarget, onSelect }: CosmosNavProps) {
  if (archives.length === 0) return null;

  return (
    <nav className="cosmos-nav" aria-label="Cosmos camera navigation">
      <button
        type="button"
        className={`cosmos-nav__btn ${navTarget === 'global' ? 'cosmos-nav__btn--active' : ''}`}
        onClick={() => onSelect('global')}
        aria-pressed={navTarget === 'global'}
      >
        Global
      </button>
      {archives.map((archive, index) => (
        <button
          key={archive.id}
          type="button"
          className={`cosmos-nav__btn ${navTarget === archive.id ? 'cosmos-nav__btn--active' : ''}`}
          onClick={() => onSelect(archive.id)}
          aria-pressed={navTarget === archive.id}
        >
          Galaxy {index + 1}
        </button>
      ))}
      <button
        type="button"
        className={`cosmos-nav__btn ${navTarget === 'active' ? 'cosmos-nav__btn--active' : ''}`}
        onClick={() => onSelect('active')}
        aria-pressed={navTarget === 'active'}
      >
        Current cluster
      </button>
    </nav>
  );
}
