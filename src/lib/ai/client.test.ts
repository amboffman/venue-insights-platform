import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { ask } from "./client";

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("ask", () => {
  it("returns the text block and token usage", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "hello world" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await ask("hi");

    expect(result).toEqual({
      text: "hello world",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
  });

  it("throws when the response contains no text block", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(ask("hi")).rejects.toThrow(/no text block/i);
  });
});
