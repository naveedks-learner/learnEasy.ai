import katex from "katex";
import { Fragment, type ReactNode } from "react";

function render(tex: string, displayMode: boolean) {
  return katex.renderToString(tex, { displayMode, throwOnError: false });
}

function inlineBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, j) => {
        const m = part.match(/^\*\*(.+)\*\*$/);
        if (m) return <strong key={j}>{m[1]}</strong>;
        return <Fragment key={j}>{part}</Fragment>;
      })}
    </>
  );
}

function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(\s*)[-•]\s+(.*)/);
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);

    if (bulletMatch) {
      elements.push(<div key={i} style={{ paddingLeft: 16 }}>• {inlineBold(bulletMatch[2])}</div>);
    } else if (numMatch) {
      elements.push(<div key={i} style={{ paddingLeft: 16 }}>{numMatch[2]}. {inlineBold(numMatch[3])}</div>);
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(<span key={i}>{inlineBold(line)}{i < lines.length - 1 ? "\n" : ""}</span>);
    }
  }

  return elements;
}

/** Renders text with KaTeX math + basic markdown (bold, bullets, numbered lists). */
export function Latex({ text }: { text: string }) {
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  const parts: Array<{ t: "text" | "block" | "inline"; v: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: "text", v: text.slice(last, m.index) });
    const block = m[1] ?? m[2];
    if (block !== undefined) parts.push({ t: "block", v: block });
    else parts.push({ t: "inline", v: m[3] ?? m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: "text", v: text.slice(last) });
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.t === "text" ? (
          <Fragment key={i}>{renderMarkdown(p.v)}</Fragment>
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: render(p.v, p.t === "block") }} />
        ),
      )}
    </span>
  );
}

/** A bare formula (no delimiters). */
export function Formula({ tex }: { tex: string }) {
  const clean = tex.replace(/^\s*\$\$?|\$\$?\s*$/g, "");
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: render(clean, true) }} />;
}
