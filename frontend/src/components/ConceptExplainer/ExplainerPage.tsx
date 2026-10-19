import { useState, type FormEvent, type ReactNode } from "react";
import { postExplain, type ExplainResponse } from "../../api/client";
import { Formula, Latex } from "../common/Latex";
import { LoadingSpinner } from "../common/LoadingSpinner";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-primary)]">{title}</h3>
      {children}
    </section>
  );
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function MarkdownTable({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const isSep = (l: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l);
  if (lines.length < 2 || !lines[0].includes("|") || !isSep(lines[1])) {
    return <pre className="overflow-x-auto whitespace-pre text-sm">{text}</pre>;
  }
  const headers = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-1 text-left"><Latex text={h} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j} className="border border-slate-300 px-2 py-1"><Latex text={c} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExplainerPage() {
  const [concept, setConcept] = useState("");
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!concept.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await postExplain(concept.trim()));
    } catch (err) {
      setError((err as Error).message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const r = result;
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Enter a concept, e.g. photosynthesis"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        <button type="submit" disabled={loading || !concept.trim()} className="rounded-lg px-4 py-2 text-white bg-[var(--color-primary)] disabled:opacity-50">
          Explain
        </button>
      </form>
      {loading && <LoadingSpinner label="Generating explanation" />}
      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
      {r && !loading && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">{r.concept}</h2>
          {r.simpleExplanation && (
            <Section title="Simple explanation">
              <Latex text={r.simpleExplanation} />
            </Section>
          )}
          {r.definition && (
            <Section title="Definition">
              <Latex text={r.definition} />
            </Section>
          )}
          {r.formula && (
            <Section title="Formula">
              <Formula tex={r.formula} />
            </Section>
          )}
          {r.steps && r.steps.length > 0 && (
            <Section title="Steps">
              <ol className="list-decimal pl-5 space-y-1">
                {r.steps.map((s, i) => (
                  <li key={i}>
                    <Latex text={s} />
                  </li>
                ))}
              </ol>
            </Section>
          )}
          {r.table && (
            <Section title="Table">
              <MarkdownTable text={r.table} />
            </Section>
          )}
          {r.realWorldExample && (
            <Section title="Real-world example">
              <Latex text={r.realWorldExample} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
