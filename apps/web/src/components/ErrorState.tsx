interface ErrorStateProps {
  title?: string;
  message: string;
  issues?: string[];
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  issues,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="notice notice-danger" role="alert">
      <h3 className="notice-title">{title}</h3>
      <p>{message}</p>
      {issues && issues.length > 0 && (
        <ul>
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
