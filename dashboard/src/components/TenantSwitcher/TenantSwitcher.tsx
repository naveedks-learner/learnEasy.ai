import type { TenantConfig } from "../../api/client";

export default function TenantSwitcher({ tenants, activeId, onChange }: {
  tenants: TenantConfig[]; activeId: string | null; onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">School</span>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 font-medium"
        value={activeId ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>Select a school…</option>
        {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
      </select>
    </label>
  );
}
