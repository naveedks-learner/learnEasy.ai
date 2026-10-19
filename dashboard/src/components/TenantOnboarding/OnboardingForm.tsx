import { useState, type FormEvent } from "react";
import { api, type TenantConfig } from "../../api/client";

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const MAX_LOGO_BYTES = 256 * 1024;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export default function OnboardingForm({ onCreated, onCancel }: {
  onCreated: (t: TenantConfig) => void; onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [domain, setDomain] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primary, setPrimary] = useState("#2563eb");
  const [accent, setAccent] = useState("#1e40af");
  const [features, setFeatures] = useState({ conceptExplainerEnabled: true, questionPaperEnabled: true, webSearchEnabled: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onLogo = (file: File | undefined) => {
    if (!file) return setLogoUrl("");
    if (file.size > MAX_LOGO_BYTES) {
      setLogoUrl("");
      return setError("Logo must be 256KB or smaller");
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("School name is required");
    if (!SLUG_RE.test(slug)) return setError("Tenant ID must be lowercase letters, numbers and hyphens");
    if (!DOMAIN_RE.test(domain.trim())) return setError("Enter a valid domain, e.g. chat.school.edu");
    setBusy(true);
    setError(null);
    try {
      const tenant = await api.createTenant({
        tenantId: slug, name: name.trim(), domain: domain.trim().toLowerCase(), logoUrl,
        theme: { primaryColor: primary, accentColor: accent }, features,
      });
      onCreated(tenant);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded border border-slate-300 px-2 py-1";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Onboard New School</h3>
      <label className="block text-sm">School name *
        <input className={input} value={name} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />
      </label>
      <label className="block text-sm">Tenant ID
        <input className={input} value={slug} onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} />
      </label>
      <label className="block text-sm">Domain *
        <input className={input} placeholder="chat.school.edu" value={domain} onChange={(e) => setDomain(e.target.value)} />
      </label>
      <label className="block text-sm">Logo (optional)
        <input type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0])} />
      </label>
      <div className="flex gap-4 text-sm">
        <label>Primary color <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} /></label>
        <label>Accent color <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
      </div>
      <fieldset className="text-sm">
        <legend className="text-slate-500">Features</legend>
        {(Object.keys(features) as Array<keyof typeof features>).map((k) => (
          <label key={k} className="mr-4 inline-flex items-center gap-1">
            <input type="checkbox" checked={features[k]} onChange={(e) => setFeatures({ ...features, [k]: e.target.checked })} />{k}
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">{busy ? "Creating…" : "Create school"}</button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1 text-sm">Cancel</button>
      </div>
    </form>
  );
}
