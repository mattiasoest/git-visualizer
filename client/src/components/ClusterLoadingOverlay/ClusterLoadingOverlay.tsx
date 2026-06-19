import './ClusterLoadingOverlay.css';

export function ClusterLoadingOverlay() {
  return (
    <div className="cluster-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div>
        <div className="cluster-loading-overlay__ring" />
        <p className="cluster-loading-overlay__label">Preparing cluster…</p>
      </div>
    </div>
  );
}
