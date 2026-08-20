export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint muted">{hint}</div>}
    </div>
  );
}
