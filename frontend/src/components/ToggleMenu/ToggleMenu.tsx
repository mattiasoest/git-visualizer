import { useEffect, useId, useRef, useState } from 'react';
import './ToggleMenu.css';

export interface ToggleMenuItem {
  id: string;
  label: string;
  active?: boolean;
  color?: string;
}

interface ToggleMenuProps {
  items: ToggleMenuItem[];
  onItemClick: (id: string) => void;
  mode: 'multi' | 'single';
  ariaLabel: string;
  triggerLabel?: string;
  iconOnly?: boolean;
  className?: string;
}

function MenuIcon() {
  return (
    <svg
      className="toggle-menu__trigger-svg"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 4.5h12M2 8h12M2 11.5h12"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ToggleMenu({
  items,
  onItemClick,
  mode,
  ariaLabel,
  triggerLabel,
  iconOnly = false,
  className,
}: ToggleMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleItemClick = (id: string) => {
    onItemClick(id);
    if (mode === 'single') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`toggle-menu${iconOnly ? ' toggle-menu--icon-only' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className={`toggle-menu__trigger${open ? ' toggle-menu__trigger--open' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="toggle-menu__trigger-icon" aria-hidden="true">
          <MenuIcon />
        </span>
        {!iconOnly && triggerLabel ? (
          <span className="toggle-menu__trigger-label">{triggerLabel}</span>
        ) : null}
      </button>
      {open ? (
        <div
          id={menuId}
          className="toggle-menu__panel"
          role="menu"
          aria-label={ariaLabel}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={mode === 'multi' ? 'menuitemcheckbox' : 'menuitemradio'}
              aria-checked={item.active}
              className={`toggle-menu__item${item.active ? ' toggle-menu__item--active' : ''}`}
              style={
                item.color
                  ? ({ '--item-color': item.color } as React.CSSProperties)
                  : undefined
              }
              onClick={() => handleItemClick(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
