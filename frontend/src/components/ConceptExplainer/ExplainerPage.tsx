import { useState, type FormEvent, type ReactNode } from "react";
import { postExplain, type ExplainResponse } from "../../api/client";
import { Formula, Latex } from "../common/Latex";
import { Thinking } from "../common/LoadingSpinner";

const PHRASES = ["Breaking it down…", "Finding the key idea…", "Looking for a good example…", "Making it simple…"];

function Section({ title, children, className = "", delay = 0 }: { title: string; children: ReactNode; className?: string; delay?: number }) {
  return (
    <section className={`sec ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <h3>{title}</h3>
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
      <table className="tbl">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}><Latex text={h} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}><Latex text={c} /></td>
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
    <div className="ex-wrap">
      <form onSubmit={submit} className="ex-form">
        <input
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Enter a concept, e.g. photosynthesis"
          aria-label="Concept"
          className="input"
        />
        <button type="submit" disabled={loading || !concept.trim()} className="ex-btn">
          Explain
        </button>
      </form>
      <div className="scroll" style={{ paddingTop: 0 }}>
        {!r && !loading && !error && (
          <div className="empty">
            <div className="orb" aria-hidden="true" />
            <h2>Concept Explainer</h2>
            <p>Type any topic and get a clear, structured breakdown.</p>
          </div>
        )}
        {loading && <Thinking phrases={PHRASES} label="Generating explanation" />}
        {error && <p className="err-box">{error}</p>}
        {r && !loading && (
          <>
            <h2 className="ex-title">{r.concept}</h2>
            {r.simpleExplanation && (
              <Section title="Simple explanation">
                <Latex text={r.simpleExplanation} />
              </Section>
            )}
            {r.definition && (
              <Section title="Definition" delay={60}>
                <Latex text={r.definition} />
              </Section>
            )}
            {r.formula && (
              <Section title="Formula" className="formula" delay={120}>
                <Formula tex={r.formula} />
              </Section>
            )}
            {r.steps && r.steps.length > 0 && (
              <Section title="Steps" delay={180}>
                <ol className="steps">
                  {r.steps.map((s, i) => (
                    <li key={i}>
                      <span style={{ minWidth: 0 }}>
                        <Latex text={s} />
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}
            {r.table && (
              <Section title="Table" delay={240}>
                <MarkdownTable text={r.table} />
              </Section>
            )}
            {r.realWorldExample && (
              <Section title="Real-world example" delay={300}>
                <Latex text={r.realWorldExample} />
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
