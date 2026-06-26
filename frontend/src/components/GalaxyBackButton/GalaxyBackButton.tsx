import './GalaxyBackButton.css';

interface GalaxyBackButtonProps {
  onBack: () => void;
}

export function GalaxyBackButton({ onBack }: GalaxyBackButtonProps) {
  return (
    <button
      type="button"
      className="galaxy-back-btn"
      onClick={onBack}
      aria-label="Back to cosmos overview"
    >
      ← Back to cosmos
    </button>
  );
}
