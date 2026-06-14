import './Controls.css';

interface ControlsProps {
  labelsVisible: boolean;
  autoRotating: boolean;
  onToggleLabels: () => void;
  onResumeAutoRotate: () => void;
}

export function Controls({
  labelsVisible,
  autoRotating,
  onToggleLabels,
  onResumeAutoRotate,
}: ControlsProps) {
  return (
    <>
      <button
        type="button"
        className="space-labels-btn"
        aria-pressed={labelsVisible}
        aria-label={labelsVisible ? 'Hide text labels' : 'Show text labels'}
        onClick={onToggleLabels}
      >
        {labelsVisible ? 'Labels ON' : 'Labels OFF'}
      </button>
      {!autoRotating && (
        <button
          type="button"
          className="space-auto-rotate-btn"
          onClick={onResumeAutoRotate}
          aria-label="Resume auto-rotation"
        >
          ↻ Auto-rotate
        </button>
      )}
    </>
  );
}
