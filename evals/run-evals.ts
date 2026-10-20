/**
 * learnEasy.ai Retrieval & Answer Quality Eval Suite
 *
 * Hits the live deployment (staging or prod) and validates:
 *   1. Retrieval: correct document in top-k, reranker producing scores
 *   2. Answer: non-empty, keyword overlap with expected terms, no error prefixes
 *   3. Source attribution: answer cites the expected document
 *
 * Usage:
 *   npx tsx evals/run-evals.ts                          # staging (default)
 *   npx tsx evals/run-evals.ts --env prod               # production
 *   npx tsx evals/run-evals.ts --tenant nps              # single tenant
 *   npx tsx evals/run-evals.ts --query "what is myopia"  # single query
 *   npx tsx evals/run-evals.ts --retrieval-only          # skip LLM answer check
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Config ──────────────────────────────────────────────────────────

interface EvalCase {
  query: string;
  expectedDoc: string;
  expectedKeywords: string[];
  expectedPages?: number[];
  description?: string;
}

interface TenantEval {
  name: string;
  documents: string[];
  cases: EvalCase[];
}

interface EvalConfig {
  baseUrl: string;
  adminKey: string;
  tenants: Record<string, TenantEval>;
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "what", "which", "who",
  "how", "why", "when", "where", "do", "does", "did", "of", "in", "on",
  "to", "and", "or", "for", "explain", "describe", "tell", "me", "about",
  "it", "its", "this", "that", "be", "been", "being", "have", "has", "had",
]);

const ERROR_PREFIXES = [
  "sorry, i hit a",
  "sorry, i couldn't",
  "i don't have enough",
  "i couldn't find",
];

// ── CLI Args ────────────────────────────────────────────────────────

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

// ── HTTP Helpers ────────────────────────────────────────────────────

async function relevanceCheck(
  baseUrl: string, adminKey: string, tenantId: string, query: string, topK = 10,
): Promise<any> {
  const res = await fetch(`${baseUrl}/admin/relevance-check`, {
    method: "POST",
    headers: { "x-admin-key": adminKey, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, query, top_k: topK }),
  });
  if (!res.ok) throw new Error(`relevance-check ${res.status}: ${await res.text()}`);
  return res.json();
}

async function chatQuery(
  baseUrl: string, adminKey: string, tenantId: string, question: string,
): Promise<any> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": tenantId,
      "x-admin-key": adminKey,
    },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Eval Logic ──────────────────────────────────────────────────────

interface Finding {
  severity: "FAIL" | "WARN";
  test: string;
  detail: string;
}

function checkRetrieval(data: any, evalCase: EvalCase): Finding[] {
  const findings: Finding[] = [];
  const tag = `[retrieval] "${evalCase.query}"`;

  if (!data.results || data.results.length === 0) {
    findings.push({ severity: "FAIL", test: tag, detail: "0 results returned" });
    return findings;
  }

  // Reranker working?
  if (!data.rerankWorking) {
    findings.push({ severity: "FAIL", test: tag, detail: "reranker not producing scores" });
  }

  // Expected doc in top-3?
  const top3Files = data.results.slice(0, 3).map((r: any) => r.filename);
  if (!top3Files.includes(evalCase.expectedDoc)) {
    const allFiles = data.results.map((r: any) => `${r.filename}(rank=${r.rank})`).join(", ");
    findings.push({
      severity: "FAIL",
      test: tag,
      detail: `expected "${evalCase.expectedDoc}" in top 3, got: ${allFiles}`,
    });
  }

  // Expected doc as rank 1?
  if (data.results[0].filename !== evalCase.expectedDoc) {
    findings.push({
      severity: "WARN",
      test: tag,
      detail: `rank 1 is "${data.results[0].filename}" (rerank=${data.results[0].rerank}), expected "${evalCase.expectedDoc}"`,
    });
  }

  // Expected page in top-3?
  if (evalCase.expectedPages && evalCase.expectedPages.length > 0) {
    const top3Pages = data.results.slice(0, 3).map((r: any) => Number(r.page));
    const foundPage = evalCase.expectedPages.some((p) => top3Pages.includes(p));
    if (!foundPage) {
      findings.push({
        severity: "WARN",
        test: tag,
        detail: `expected pages [${evalCase.expectedPages}] in top 3, got pages [${top3Pages}]`,
      });
    }
  }

  // Rerank score separation: top result should be >0.3
  const topRerank = parseFloat(data.results[0].rerank);
  if (data.rerankWorking && topRerank < 0.3) {
    findings.push({
      severity: "WARN",
      test: tag,
      detail: `top rerank score ${topRerank} is below 0.3 — weak relevance`,
    });
  }

  return findings;
}

function checkAnswer(chatResult: any, evalCase: EvalCase): Finding[] {
  const findings: Finding[] = [];
  const tag = `[answer] "${evalCase.query}"`;

  const answer = (chatResult.answer || "").trim();
  if (!answer) {
    findings.push({ severity: "FAIL", test: tag, detail: "empty answer" });
    return findings;
  }

  // Error response?
  const answerLower = answer.toLowerCase();
  for (const prefix of ERROR_PREFIXES) {
    if (answerLower.startsWith(prefix)) {
      findings.push({ severity: "FAIL", test: tag, detail: `error response: "${answer.slice(0, 100)}"` });
      return findings;
    }
  }

  // Keyword overlap with expected terms
  const foundKeywords = evalCase.expectedKeywords.filter((kw) => answerLower.includes(kw.toLowerCase()));
  const missingKeywords = evalCase.expectedKeywords.filter((kw) => !answerLower.includes(kw.toLowerCase()));
  if (foundKeywords.length === 0) {
    findings.push({
      severity: "FAIL",
      test: tag,
      detail: `none of expected keywords found: [${evalCase.expectedKeywords.join(", ")}]`,
    });
  } else if (missingKeywords.length > 0) {
    findings.push({
      severity: "WARN",
      test: tag,
      detail: `missing keywords: [${missingKeywords.join(", ")}] (found: [${foundKeywords.join(", ")}])`,
    });
  }

  // Question keyword overlap (answer should mention at least one non-stopword from question)
  const qWords = evalCase.query
    .split(/\s+/)
    .map((w) => w.replace(/[.,?!;:]/g, "").toLowerCase())
    .filter((w) => !STOPWORDS.has(w) && w.length > 2);
  const hasQuestionWord = qWords.some((w) => answerLower.includes(w));
  if (!hasQuestionWord) {
    findings.push({
      severity: "FAIL",
      test: tag,
      detail: `answer doesn't mention any question keyword: [${qWords.join(", ")}]`,
    });
  }

  // Source attribution: docSources should include expected document
  const docSources = chatResult.docSources || [];
  if (docSources.length > 0) {
    const sourceFiles = docSources.map((s: any) => s.filename);
    if (!sourceFiles.includes(evalCase.expectedDoc)) {
      findings.push({
        severity: "WARN",
        test: tag,
        detail: `docSources [${sourceFiles.join(", ")}] doesn't include "${evalCase.expectedDoc}"`,
      });
    }
  }

  return findings;
}

// ── Reporter ────────────────────────────────────────────────────────

function printReport(
  tenantId: string,
  tenantName: string,
  results: Array<{ query: string; retrieval: Finding[]; answer: Finding[]; timings: { retrieval: number; answer: number } }>,
) {
  const totalCases = results.length;
  let totalFails = 0;
  let totalWarns = 0;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  EVAL REPORT: ${tenantName} (${tenantId})`);
  console.log(`${"═".repeat(70)}\n`);

  for (const r of results) {
    const allFindings = [...r.retrieval, ...r.answer];
    const fails = allFindings.filter((f) => f.severity === "FAIL");
    const warns = allFindings.filter((f) => f.severity === "WARN");
    totalFails += fails.length;
    totalWarns += warns.length;

    const status = fails.length > 0 ? "❌ FAIL" : warns.length > 0 ? "⚠️  WARN" : "✅ PASS";
    console.log(`${status}  ${r.query}  (retrieval ${r.timings.retrieval}ms, answer ${r.timings.answer}ms)`);

    for (const f of allFindings) {
      const icon = f.severity === "FAIL" ? "    ✗" : "    ⚡";
      console.log(`${icon} ${f.detail}`);
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`  Cases: ${totalCases}  |  Fails: ${totalFails}  |  Warns: ${totalWarns}  |  Clean: ${totalCases - results.filter((r) => [...r.retrieval, ...r.answer].some((f) => f.severity === "FAIL")).length}/${totalCases}`);
  console.log(`${"─".repeat(70)}\n`);

  return totalFails;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const configPath = resolve(__dirname, "eval-config.json");
  const config: EvalConfig = JSON.parse(readFileSync(configPath, "utf-8"));

  // Resolve base URL
  if (opts.env === "prod") {
    config.baseUrl = config.baseUrl.replace("-staging", "");
  }

  // Resolve admin key from env var or .dev.vars
  let adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    try {
      const devVars = readFileSync(resolve(__dirname, "../worker/.dev.vars"), "utf-8");
      const match = devVars.match(/ADMIN_API_KEY="?([^"\n]+)"?/);
      if (match) adminKey = match[1];
    } catch { /* ignore */ }
  }
  if (!adminKey) {
    console.error("ERROR: Set ADMIN_API_KEY env var or ensure worker/.dev.vars exists");
    process.exit(1);
  }

  const retrievalOnly = opts["retrieval-only"] === "true";
  const filterTenant = opts.tenant;
  const filterQuery = opts.query;

  console.log(`\n🔬 learnEasy.ai Eval Suite`);
  console.log(`   Target: ${config.baseUrl}`);
  console.log(`   Mode: ${retrievalOnly ? "retrieval-only" : "full (retrieval + answer)"}`);
  if (filterTenant) console.log(`   Tenant: ${filterTenant}`);
  if (filterQuery) console.log(`   Query: "${filterQuery}"`);
  console.log();

  let totalFails = 0;

  for (const [tenantId, tenant] of Object.entries(config.tenants)) {
    if (filterTenant && filterTenant !== tenantId) continue;

    let cases = tenant.cases;
    if (filterQuery) {
      cases = cases.filter((c) => c.query.toLowerCase().includes(filterQuery.toLowerCase()));
    }
    if (cases.length === 0) {
      console.log(`⏭  Skipping ${tenantId}: no matching cases`);
      continue;
    }

    const results: Array<{
      query: string;
      retrieval: Finding[];
      answer: Finding[];
      timings: { retrieval: number; answer: number };
    }> = [];

    for (const evalCase of cases) {
      process.stdout.write(`  ⏳ ${evalCase.query}...`);

      // Retrieval check
      let retrievalFindings: Finding[] = [];
      let retrievalMs = 0;
      try {
        const t0 = Date.now();
        const data = await relevanceCheck(config.baseUrl, adminKey, tenantId, evalCase.query);
        retrievalMs = Date.now() - t0;
        retrievalFindings = checkRetrieval(data, evalCase);
      } catch (e) {
        retrievalFindings = [{ severity: "FAIL", test: `[retrieval] "${evalCase.query}"`, detail: `error: ${(e as Error).message}` }];
      }

      // Answer check
      let answerFindings: Finding[] = [];
      let answerMs = 0;
      if (!retrievalOnly) {
        try {
          const t0 = Date.now();
          const chatResult = await chatQuery(config.baseUrl, adminKey, tenantId, evalCase.query);
          answerMs = Date.now() - t0;
          answerFindings = checkAnswer(chatResult, evalCase);
        } catch (e) {
          answerFindings = [{ severity: "FAIL", test: `[answer] "${evalCase.query}"`, detail: `error: ${(e as Error).message}` }];
        }
      }

      process.stdout.write("\r" + " ".repeat(80) + "\r");
      results.push({ query: evalCase.query, retrieval: retrievalFindings, answer: answerFindings, timings: { retrieval: retrievalMs, answer: answerMs } });
    }

    totalFails += printReport(tenantId, tenant.name, results);
  }

  process.exit(totalFails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
