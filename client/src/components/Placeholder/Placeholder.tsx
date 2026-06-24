import './Placeholder.css';

export function Placeholder() {
  return (
    <div className="space-placeholder">
      <div className="space-placeholder__ring" />
      <p>Scanning the cosmos for GitHub activity...</p>
      <p className="hint">
        Repositories appear as crystal worlds — type-colored particles arc from
        each one, settle into orbit with repo tethers, and label the actor
        behind every action.
      </p>
    </div>
  );
}
