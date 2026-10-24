export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-card" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className="skeleton skeleton-heading" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-line skeleton-short" />
      <span className="skeleton skeleton-panel" />
    </div>
  );
}
