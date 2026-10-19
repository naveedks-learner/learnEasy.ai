import katex from "katex";
import { Fragment } from "react";

function render(tex: string, displayMode: boolean) {
  return katex.renderToString(tex, { displayMode, throwOnError: false });
}

/** Renders text, converting $$..$$, \[..\], $..$ and \(..\) segments with KaTeX. */
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
          <Fragment key={i}>{p.v}</Fragment>
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
