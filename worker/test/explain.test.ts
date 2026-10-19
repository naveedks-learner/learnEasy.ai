import { describe, it, expect } from "vitest";
import { parseExplainLlmResponse } from "../src/explain";

describe("parseExplainLlmResponse", () => {
  it("parses valid JSON from fenced code block", () => {
    const raw = '```json\n{"concept":"force","simpleExplanation":"push or pull","steps":null,"formula":"F=ma","definition":"Force is...","table":null,"realWorldExample":"kicking a ball"}\n```';
    const result = parseExplainLlmResponse(raw);
    expect(result.concept).toBe("force");
    expect(result.formula).toBe("F=ma");
  });

  it("never throws — falls back to raw text in simpleExplanation", () => {
    const result = parseExplainLlmResponse("this is not json at all");
    expect(result.simpleExplanation).toBe("this is not json at all");
    expect(result.formula).toBeNull();
  });

  it("handles truncated JSON gracefully", () => {
    const result = parseExplainLlmResponse('```json\n{"concept":"force","simpleExp');
    expect(result.simpleExplanation).toBeTruthy();
  });

  it("falls back when JSON lacks simpleExplanation", () => {
    const result = parseExplainLlmResponse('{"concept":"force"}');
    expect(result.simpleExplanation).toBe('{"concept":"force"}');
  });
});
