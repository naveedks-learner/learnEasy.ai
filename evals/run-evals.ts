/**
 * learnEasy.ai Retrieval & Answer Quality Eval Suite
 *
 * Inspired by EdukripaLive's eval harness: LLM-judge grading with cheap-keyword fallback,
 * golden-cases.json with keyFacts, JSON report output.
 *
 * Usage:
 *   npx tsx evals/run-evals.ts                          # staging (default), LLM judge
 *   npx tsx evals/run-evals.ts --env prod               # production
 *   npx tsx evals/run-evals.ts --no-judge               # cheap keyword check only (no LLM cost)
 *   npx tsx evals/run-evals.ts --tenant nps              # single tenant
 *   npx tsx evals/run-evals.ts --id eye-1                # single case by id
 *   npx tsx evals/run-evals.ts --mode chat               # chat cases only
 *   npx tsx evals/run-evals.ts --mode explain            # explain cases only
 *   npx tsx evals/run-evals.ts --retrieval-only          # skip answer grading entirely
 *   npx tsx evals/run-evals.ts --feature-changed "msg"   # label stored in report
 *   npx tsx evals/run-evals.ts --judge-model slug        # override judge model
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";

// ── Types ──────────────────────────────────────────────────────────

interface GoldenCase {
  id: string;
  mode: "chat" | "explain";
  docFilename: string | null;
  question?: string;
  concept?: string;
  keyFacts: string[];
  cheapKeywords: string[];
}

interface EvalConfig {
  baseUrl: string;
  adminKey: string;
  tenants: Record<string, { name: string; documents: string[] }>;
}

interface Verdict { pass: boolean; reason: string }

interface CaseResult {
  id: string;
  mode: string;
  pass: boolean;
  reason: string;
  retrievalMs: number;
  answerMs: number;
  retrievalOk: boolean;
  retrievalDetail?: string;
  answerText?: string;
}

// ── Constants ──────────────────────────────────────────────────────

const JUDGE_MODEL_DEFAULT = "openai/gpt-4o-mini";

const JUDGE_SYSTEM_PROMPT =
  "You are grading a student-facing answer for factual correctness against a list of key facts. " +
  "Each key fact must be correctly conveyed IN MEANING — paraphrasing, reordering, different wording, or " +
  "extra correct detail all count as a pass. Only fail if a key fact is actually missing, contradicted, or " +
  "replaced with something factually wrong. Do not fail for missing elaboration, missing citations, " +
  "formatting differences, or brevity. Reply with ONLY a JSON object: " +
  '{"pass": boolean, "reason": "one short sentence"}.';

// ── CLI Args ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      opts[args[i].slice(2)] = args[++i];
    } else if (args[i].startsWith("--")) {
      opts[args[i].slice(2)] = "true";
    }
  }
  return opts;
}

// ── Secrets ────────────────────────────────────────────────────────

function loadDevVars(): Record<string, string> {
  try {
    const text = readFileSync(resolve(__dirname, "../worker/.dev.vars"), "utf-8");
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

// ── HTTP Helpers ───────────────────────────────────────────────────

async function chatQuery(baseUrl: string, adminKey: string, tenantId: string, question: string): Promise<any> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tenant": tenantId, "x-admin-key": adminKey },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `chat ${res.status}`);
  return body;
}

async function explainQuery(baseUrl: string, adminKey: string, tenantId: string, concept: string): Promise<any> {
  const res = await fetch(`${baseUrl}/api/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tenant": tenantId, "x-admin-key": adminKey },
    body: JSON.stringify({ concept }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `explain ${res.status}`);
  return body;
}

async function relevanceCheck(baseUrl: string, adminKey: string, tenantId: string, query: string): Promise<any> {
  const res = await fetch(`${baseUrl}/admin/relevance-check`, {
    method: "POST",
    headers: { "x-admin-key": adminKey, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, query, top_k: 10 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`relevance-check ${res.status}`);
  return res.json();
}

// ── Grading ────────────────────────────────────────────────────────

function parseLlmJson(raw: string): any {
  const attempts = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) attempts.push(fenced[1]);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) attempts.push(raw.slice(first, last + 1));
  for (const c of attempts) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  throw new Error(`judge returned unparseable JSON: ${raw.slice(0, 200)}`);
}

async function judgeGrade(openrouterKey: string, judgeModel: string, keyFacts: string[], answerText: string): Promise<Verdict> {
  const user =
    `Key facts the answer must correctly convey:\n${keyFacts.map((f) => `- ${f}`).join("\n")}\n\n` +
    `Actual answer:\n${answerText || "(empty)"}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: judgeModel,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      max_tokens: 150,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter judge failed (${res.status})`);
  const body = await res.json() as any;
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("judge returned no content");
  const parsed = parseLlmJson(content);
  return { pass: parsed.pass === true, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
}

function cheapGrade(cheapKeywords: string[], text: string): Verdict {
  const haystack = (text || "").toLowerCase();
  const missing = cheapKeywords.filter((kw) => !haystack.includes(kw.toLowerCase()));
  return {
    pass: missing.length === 0,
    reason: missing.length ? `missing: ${missing.join(", ")}` : "all keywords present",
  };
}

function combineExplainText(body: any): string {
  const tableText = body.table
    ? (typeof body.table === "string" ? body.table : JSON.stringify(body.table))
    : "";
  return [
    body.simpleExplanation,
    Array.isArray(body.steps) ? body.steps.join(" ") : "",
    body.formula,
    body.definition,
    tableText,
    body.realWorldExample,
  ].filter(Boolean).join("\n");
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const configPath = resolve(__dirname, "eval-config.json");
  const config: EvalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  const golden: { cases: GoldenCase[] } = JSON.parse(readFileSync(resolve(__dirname, "golden-cases.json"), "utf-8"));

  if (opts.env === "prod") config.baseUrl = config.baseUrl.replace("-staging", "");

  const devVars = loadDevVars();
  const adminKey = process.env.ADMIN_API_KEY ?? devVars.ADMIN_API_KEY;
  if (!adminKey) { console.error("ERROR: Set ADMIN_API_KEY env var or ensure worker/.dev.vars has it"); process.exit(1); }

  const openrouterKey = process.env.OPENROUTER_API_KEY ?? devVars.OPENROUTER_API_KEY ?? "";
  const useJudge = opts["no-judge"] !== "true";
  const judgeModel = opts["judge-model"] ?? JUDGE_MODEL_DEFAULT;
  const retrievalOnly = opts["retrieval-only"] === "true";
  const filterTenant = opts.tenant ?? "nps";
  const filterId = opts.id;
  const filterMode = opts.mode as "chat" | "explain" | undefined;
  const featureChanged = opts["feature-changed"] ?? null;

  if (useJudge && !openrouterKey) {
    console.error("OPENROUTER_API_KEY not found. Use --no-judge for cheap keyword fallback.");
    process.exit(1);
  }

  let cases = golden.cases;
  if (filterId) cases = cases.filter((c) => c.id === filterId);
  if (filterMode) cases = cases.filter((c) => c.mode === filterMode);

  console.log(`\n🔬 learnEasy.ai Eval Suite`);
  console.log(`   Target: ${config.baseUrl}`);
  console.log(`   Tenant: ${filterTenant}`);
  console.log(`   Cases: ${cases.length}`);
  console.log(`   Grading: ${useJudge ? `LLM judge (${judgeModel})` : "cheap keyword"}`);
  console.log(`   Mode: ${retrievalOnly ? "retrieval-only" : filterMode ?? "all"}`);
  if (featureChanged) console.log(`   Changed: ${featureChanged}`);
  console.log();

  const results: CaseResult[] = [];

  for (const tc of cases) {
    const query = tc.question ?? tc.concept ?? tc.id;
    process.stdout.write(`  ⏳ [${tc.id}] ${query.slice(0, 60)}...`);

    let retrievalOk = true;
    let retrievalDetail = "";
    let retrievalMs = 0;

    // Retrieval check
    try {
      const t0 = Date.now();
      const data = await relevanceCheck(config.baseUrl, adminKey, filterTenant, query);
      retrievalMs = Date.now() - t0;

      if (!data.results || data.results.length === 0) {
        retrievalOk = false;
        retrievalDetail = "0 results returned";
      } else if (tc.docFilename) {
        const top3 = data.results.slice(0, 3).map((r: any) => r.filename);
        if (!top3.includes(tc.docFilename)) {
          retrievalOk = false;
          retrievalDetail = `expected "${tc.docFilename}" in top 3, got: ${top3.join(", ")}`;
        }
      }
    } catch (e) {
      retrievalOk = false;
      retrievalDetail = `error: ${(e as Error).message}`;
    }

    // Answer check
    let verdict: Verdict = { pass: true, reason: "retrieval-only" };
    let answerText = "";
    let answerMs = 0;

    if (!retrievalOnly) {
      try {
        const t0 = Date.now();
        if (tc.mode === "chat") {
          const chatResult = await chatQuery(config.baseUrl, adminKey, filterTenant, tc.question!);
          answerMs = Date.now() - t0;
          answerText = chatResult.answer ?? "";
        } else {
          const explainResult = await explainQuery(config.baseUrl, adminKey, filterTenant, tc.concept!);
          answerMs = Date.now() - t0;
          answerText = combineExplainText(explainResult);
        }

        if (!answerText.trim()) {
          verdict = { pass: false, reason: "empty answer" };
        } else if (useJudge) {
          verdict = await judgeGrade(openrouterKey, judgeModel, tc.keyFacts, answerText);
        } else {
          verdict = cheapGrade(tc.cheapKeywords, answerText);
        }
      } catch (e) {
        verdict = { pass: false, reason: `error: ${(e as Error).message}` };
      }
    }

    const overallPass = retrievalOk && verdict.pass;
    process.stdout.write("\r" + " ".repeat(100) + "\r");

    const icon = overallPass ? "✅" : !retrievalOk ? "❌" : "⚠️";
    const timings = `(ret ${retrievalMs}ms${!retrievalOnly ? `, ans ${answerMs}ms` : ""})`;
    console.log(`${icon} [${tc.id}] ${query.slice(0, 55)} ${timings}`);
    if (!retrievalOk) console.log(`     ✗ retrieval: ${retrievalDetail}`);
    if (!verdict.pass && !retrievalOnly) console.log(`     ✗ answer: ${verdict.reason}`);

    results.push({
      id: tc.id,
      mode: tc.mode,
      pass: overallPass,
      reason: overallPass ? "pass" : [!retrievalOk ? `retrieval: ${retrievalDetail}` : "", !verdict.pass ? `answer: ${verdict.reason}` : ""].filter(Boolean).join("; "),
      retrievalMs,
      answerMs,
      retrievalOk,
      retrievalDetail: retrievalDetail || undefined,
      answerText: answerText.slice(0, 500) || undefined,
    });
  }

  // Summary
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${passCount}/${results.length} passed  |  ${failCount} failed`);
  console.log(`${"─".repeat(60)}\n`);

  // Write JSON report
  const outDir = resolve(__dirname, "results");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `${ts}.json`);
  writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    baseUrl: config.baseUrl,
    tenant: filterTenant,
    gradeMode: useJudge ? "judge" : "cheap",
    judgeModel: useJudge ? judgeModel : null,
    featureChanged,
    passCount,
    totalCount: results.length,
    results,
  }, null, 2));
  console.log(`Report: ${outPath}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
