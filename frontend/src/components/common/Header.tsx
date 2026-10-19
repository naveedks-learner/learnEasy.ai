import type { TenantInfo } from "../../api/client";

export function Header({ tenant }: { tenant: TenantInfo | null }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 text-white bg-[var(--color-primary)]">
      {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-8 w-8 rounded object-contain bg-white/20" />}
      <h1 className="text-lg font-semibold">{tenant?.name ?? ""}</h1>
    </header>
  );
}
