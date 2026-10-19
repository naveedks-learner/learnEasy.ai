import { describe, it, expect, vi } from "vitest";
import { buildTransactionTrace, insertTransaction } from "../src/transactionTrace";

const input = {
  pathTaken: "chat",
  question: "what is force",
  answer: "F = ma",
  model: "qwen/qwen3",
  provider: "openrouter",
  chunks: [{ text: "chunk", score: 0.9, kept: true }],
  tokenEstimate: 150,
};

describe("buildTransactionTrace", () => {
  it("assembles a transaction row from pipeline data", () => {
    const row = buildTransactionTrace(input);
    expect(row.path_taken).toBe("chat");
    expect(row.question).toBe("what is force");
    expect(JSON.parse(row.trace_json).chunks).toHaveLength(1);
  });
});

describe("insertTransaction", () => {
  it("binds tenant id and row fields", async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const row = buildTransactionTrace(input);
    await insertTransaction(row, "t1", { prepare } as any);
    expect(prepare.mock.calls[0][0]).toContain("INSERT INTO transactions");
    expect(bind).toHaveBeenCalledWith("t1", "chat", "what is force", "F = ma", "qwen/qwen3", "openrouter", row.trace_json, 150);
    expect(run).toHaveBeenCalled();
  });
});
