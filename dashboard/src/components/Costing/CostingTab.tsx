export default function CostingTab() {
  const metrics = ["Today", "This week", "This month"];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m} className="metric">
            <div className="metric-label">{m}</div>
            <div className="metric-value muted">&ndash;</div>
          </div>
        ))}
      </div>
      <div className="card empty">
        <div className="empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg>
        </div>
        <h3 className="font-semibold">Costing: coming soon</h3>
        <p className="muted text-sm">Will show token costs by tenant per day, week and month.</p>
      </div>
    </div>
  );
}
