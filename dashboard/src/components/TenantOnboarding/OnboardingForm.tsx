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
  const [primary, setPrimary] = useState("#ee7c5c");
  const [accent, setAccent] = useState("#a86bd8");
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

  const featureLabels: Record<string, string> = {
    conceptExplainerEnabled: "Concept Explainer",
    questionPaperEnabled: "Question Papers",
    webSearchEnabled: "Web Search Fallback",
  };

  return (
    <form onSubmit={submit} className="card" style={{ borderColor: "var(--primary)", boxShadow: "var(--shadow-md)" }}>
      <div className="mb-2 flex items-center gap-3">
        <span className="step">1</span>
        <h3 className="text-lg font-semibold">Register a new school</h3>
      </div>
      <p className="muted mb-5 text-sm">Fill in the school details below. After saving, you'll get DNS setup instructions.</p>

      <div className="space-y-4">
        <label className="label">
          School name <span style={{ color: "var(--error)" }}>*</span>
          <input className="input mt-1.5 font-normal" value={name} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />
        </label>
        <label className="label">
          Tenant ID <span className="hint">(auto-generated, editable)</span>
          <input className="input mono mt-1.5 font-normal" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} />
        </label>
        <label className="label">
          Domain <span style={{ color: "var(--error)" }}>*</span>
          <input className="input mt-1.5 font-normal" placeholder="chat.school.edu" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <span className="hint mt-1 block">The hostname students will use to access the chatbot</span>
        </label>
        <label className="label">
          Logo <span className="hint">(optional, max 256KB)</span>
          <input type="file" accept="image/*" className="input mt-1.5 font-normal" onChange={(e) => onLogo(e.target.files?.[0])} />
        </label>
        <div className="flex flex-wrap gap-6 text-sm font-semibold">
          <label className="flex items-center gap-2">Primary color <input type="color" className="color-input" value={primary} onChange={(e) => setPrimary(e.target.value)} /></label>
          <label className="flex items-center gap-2">Accent color <input type="color" className="color-input" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
        </div>
        <fieldset className="text-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Features</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(features) as Array<keyof typeof features>).map((k) => (
              <label key={k} className="inline-flex items-center gap-2">
                <input type="checkbox" className="check" checked={features[k]} onChange={(e) => setFeatures({ ...features, [k]: e.target.checked })} />
                {featureLabels[k] ?? k}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error && <p className="alert alert-error mt-4">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save & Continue"}</button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
      </div>
    </form>
  );
}
