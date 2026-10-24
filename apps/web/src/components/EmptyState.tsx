interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: EmptyStateAction;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
      {action?.href && <a className="btn btn-secondary" href={action.href}>{action.label}</a>}
      {action?.onClick && <button className="btn btn-secondary" type="button" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
