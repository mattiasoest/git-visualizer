import { useMemo } from 'react';
import type { CosmosNavTarget } from '../../hooks/useCosmosNavigation';
import { ToggleMenu } from '../ToggleMenu/ToggleMenu';
import './CosmosNav.css';

interface CosmosNavProps {
  archives: { id: string }[];
  navTarget: CosmosNavTarget;
  onSelect: (target: CosmosNavTarget) => void;
}

function navTargetLabel(
  target: CosmosNavTarget,
  archives: { id: string }[],
): string {
  if (target === 'global') return 'Global';
  if (target === 'active') return 'Current cluster';
  const index = archives.findIndex((archive) => archive.id === target);
  return index >= 0 ? `Galaxy ${index + 1}` : 'Galaxy';
}

export function CosmosNav({ archives, navTarget, onSelect }: CosmosNavProps) {
  const navItems = useMemo(
    () => [
      {
        id: 'global',
        label: 'Global',
        active: navTarget === 'global',
      },
      ...archives.map((archive, index) => ({
        id: archive.id,
        label: `Galaxy ${index + 1}`,
        active: navTarget === archive.id,
      })),
      {
        id: 'active',
        label: 'Current cluster',
        active: navTarget === 'active',
      },
    ],
    [archives, navTarget],
  );

  if (archives.length === 0) return null;

  return (
    <>
      <ToggleMenu
        className="cosmos-nav__menu"
        items={navItems}
        onItemClick={(id) => onSelect(id as CosmosNavTarget)}
        mode="single"
        ariaLabel="Cosmos camera navigation"
        triggerLabel={navTargetLabel(navTarget, archives)}
      />
      <nav
        className="cosmos-nav cosmos-nav--inline"
        aria-label="Cosmos camera navigation"
      >
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
    </>
  );
}
