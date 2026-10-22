import { useState, type FormEvent, type ReactNode } from "react";
import { postExplain, type ExplainResponse, type PracticeQuestion } from "../../api/client";
import { Formula, Latex } from "../common/Latex";
import { Thinking } from "../common/LoadingSpinner";
import { SourceCard } from "../Chat/SourceCard";
import { PageImage } from "../common/PageImage";
import { PdfPageRenderer } from "../common/PdfPageRenderer";

const PHRASES = ["Breaking it down…", "Finding the key idea…", "Looking for a good example…", "Making it simple…"];

function collectExplainFigures(r: ExplainResponse): Array<{ filename: string; page: number; imageKey?: string }> {
  const seen = new Set<string>();
  const result: Array<{ filename: string; page: number; imageKey?: string }> = [];

  if (r.pageImageKey && r.docSources?.[0]) {
    const s = r.docSources[0];
    result.push({ filename: s.filename, page: s.page ?? 0, imageKey: r.pageImageKey });
    seen.add(`${s.filename}:${s.page ?? 0}`);
  }

  for (const s of r.docSources ?? []) {
    if (s.pageImageKey && !seen.has(`${s.filename}:${s.page ?? 0}`)) {
      seen.add(`${s.filename}:${s.page ?? 0}`);
      result.push({ filename: s.filename, page: s.page ?? 0, imageKey: s.pageImageKey });
    }
    for (const p of s.figurePages ?? []) {
      const key = `${s.filename}:${p}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ filename: s.filename, page: p });
      }
    }
    if (!s.pageImageKey && !s.figurePages?.length && s.hasFigure && s.filename && s.page != null) {
      const key = `${s.filename}:${s.page}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ filename: s.filename, page: s.page });
      }
    }
  }
  return result;
}

function Section({ title, icon, children, className = "", delay = 0 }: { title: string; icon?: string; children: ReactNode; className?: string; delay?: number }) {
  return (
    <section className={`sec ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <h3>{icon && <span className="sec-icon">{icon}</span>}{title}</h3>
      {children}
    </section>
  );
}

function DifficultyBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    basic: "var(--success, #22c55e)",
    intermediate: "var(--warning, #f59e0b)",
    advanced: "var(--error, #ef4444)",
  };
  return (
    <span className="diff-badge" style={{ "--badge-color": colors[level] || colors.basic } as React.CSSProperties}>
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
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

function QuizCard({ q, index }: { q: PracticeQuestion; index: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;
  const correct = selected === q.correctIndex;

  return (
    <div className="quiz-card">
      <p className="quiz-q"><strong>Q{index + 1}.</strong> <Latex text={q.question} /></p>
      <div className="quiz-opts">
        {q.options.map((opt, i) => {
          let cls = "quiz-opt";
          if (answered) {
            if (i === q.correctIndex) cls += " quiz-correct";
            else if (i === selected) cls += " quiz-wrong";
          }
          return (
            <button
              key={i}
              type="button"
              className={cls}
              disabled={answered}
              onClick={() => setSelected(i)}
            >
              <span className="quiz-letter">{String.fromCharCode(65 + i)}</span>
              <Latex text={opt} />
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`quiz-feedback ${correct ? "quiz-fb-correct" : "quiz-fb-wrong"}`}>
          <strong>{correct ? "Correct! ✓" : "Not quite ✗"}</strong>
          {q.explanation && <span> — <Latex text={q.explanation} /></span>}
        </div>
      )}
    </div>
  );
}

function YouTubeLink({ query }: { query: string }) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="yt-link">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="yt-icon">
        <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.7 31.7 0 0 0 0 12a31.7 31.7 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.84.55 9.38.55 9.38.55s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.7 31.7 0 0 0 24 12a31.7 31.7 0 0 0-.5-5.81zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
      </svg>
      <span>Watch related videos on YouTube</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

export function ExplainerPage() {
  const [concept, setConcept] = useState("");
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onExplore, setOnExplore] = useState<((c: string) => void) | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!concept.trim() || loading) return;
    doExplain(concept.trim());
  };

  const doExplain = async (term: string) => {
    setConcept(term);
    setLoading(true);
    setError(null);
    try {
      setResult(await postExplain(term));
    } catch (err) {
      setError((err as Error).message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const r = result;
  let d = 0;
  const nextDelay = () => (d += 60);

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
            <p>Type any topic and get a clear, structured breakdown with practice questions and video recommendations.</p>
          </div>
        )}
        {loading && <Thinking phrases={PHRASES} label="Generating explanation" />}
        {error && <p className="err-box">{error}</p>}
        {r && !loading && (
          <>
            <div className="ex-header">
              <h2 className="ex-title">{r.concept}</h2>
              {r.difficultyLevel && <DifficultyBadge level={r.difficultyLevel} />}
            </div>
            {r.simpleExplanation && (
              <Section title="Simple explanation" icon="💡" delay={nextDelay()}>
                <Latex text={r.simpleExplanation} />
              </Section>
            )}
            {r.definition && (
              <Section title="Definition" icon="📖" delay={nextDelay()}>
                <Latex text={r.definition} />
              </Section>
            )}
            {r.formula && (
              <Section title="Formula" icon="📐" className="formula" delay={nextDelay()}>
                <Formula tex={r.formula} />
              </Section>
            )}
            {r.steps && r.steps.length > 0 && (
              <Section title="Steps" icon="📋" delay={nextDelay()}>
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
            {(() => {
              const figures = collectExplainFigures(r);
              return figures.length > 0 ? (
                <Section title="From your textbook" icon="📷" delay={nextDelay()}>
                  <div className="answer-figures">
                    {figures.map((fp) =>
                      fp.imageKey ? (
                        <PageImage key={fp.imageKey} imageKey={fp.imageKey} alt={`Page ${fp.page} of ${fp.filename}`} />
                      ) : (
                        <PdfPageRenderer key={`${fp.filename}:${fp.page}`} filename={fp.filename} page={fp.page} alt={`Page ${fp.page} of ${fp.filename}`} />
                      ),
                    )}
                  </div>
                </Section>
              ) : null;
            })()}
            {r.table && (
              <Section title="Table" icon="📊" delay={nextDelay()}>
                <MarkdownTable text={r.table} />
              </Section>
            )}
            {r.realWorldExample && (
              <Section title="Real-world example" icon="🌍" delay={nextDelay()}>
                <Latex text={r.realWorldExample} />
              </Section>
            )}
            {r.keyTakeaways && r.keyTakeaways.length > 0 && (
              <Section title="Key takeaways" icon="🎯" delay={nextDelay()}>
                <ul className="takeaways">
                  {r.keyTakeaways.map((t, i) => (
                    <li key={i}><Latex text={t} /></li>
                  ))}
                </ul>
              </Section>
            )}
            {r.practiceQuestions && r.practiceQuestions.length > 0 && (
              <Section title="Test yourself" icon="✏️" delay={nextDelay()}>
                {r.practiceQuestions.map((q, i) => (
                  <QuizCard key={i} q={q} index={i} />
                ))}
              </Section>
            )}
            {r.youtubeSearchQuery && (
              <Section title="Watch & learn" icon="🎬" delay={nextDelay()}>
                <YouTubeLink query={r.youtubeSearchQuery} />
              </Section>
            )}
            {r.docSources && r.docSources.length > 0 && (
              <Section title="Sources" icon="📄" delay={nextDelay()}>
                <div className="sources">
                  {r.docSources.map((s, i) => (
                    <SourceCard key={i} source={s} />
                  ))}
                </div>
              </Section>
            )}
            {r.relatedConcepts && r.relatedConcepts.length > 0 && (
              <Section title="Explore next" icon="🔗" delay={nextDelay()}>
                <div className="related-chips">
                  {r.relatedConcepts.map((c, i) => (
                    <button key={i} type="button" className="chip" onClick={() => doExplain(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
