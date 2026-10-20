import type { TenantConfig } from "../../api/client";

export default function TenantSwitcher({ tenants, activeId, onChange }: {
  tenants: TenantConfig[]; activeId: string | null; onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="muted font-medium">School</span>
      <select
        className="input input-auto font-medium"
        style={{ minWidth: 180 }}
        value={activeId ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>Select a school…</option>
        {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
      </select>
    </label>
  );
}
