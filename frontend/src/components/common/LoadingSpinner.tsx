export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--color-primary)]" />
  );
}
