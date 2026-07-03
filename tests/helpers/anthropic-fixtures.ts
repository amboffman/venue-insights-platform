import type Anthropic from "@anthropic-ai/sdk";

import type { ClaudeClient } from "@/lib/ai/tool-loop";
import type { MessageStreamHandle, StreamingClaudeClient } from "@/lib/ai/stream-loop";

// Shared fake-Anthropic builders for the loop tests. Both fakes snapshot the
// request with structuredClone — the loops mutate the messages array in
// place, so recording by reference would make every requests[n].messages
// alias the same post-run array and hide ordering regressions.

export function message(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.Message["stop_reason"],
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 } as Anthropic.Usage,
  } as Anthropic.Message;
}

export function textBlock(text: string): Anthropic.TextBlock {
  return { type: "text", text, citations: null } as Anthropic.TextBlock;
}

export function toolUseBlock(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ToolUseBlock;
}

export function fakeClient(responses: Anthropic.Message[]): {
  client: ClaudeClient;
  requests: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const queue = [...responses];
  return {
    requests,
    client: {
      messages: {
        create: (params) => {
          requests.push(structuredClone(params));
          const next = queue.shift();
          if (!next) throw new Error("fake client ran out of responses");
          return Promise.resolve(next);
        },
      },
    },
  };
}

export interface FakeRound {
  deltas: string[];
  final: Anthropic.Message;
}

export function fakeStreamingClient(rounds: FakeRound[]): {
  client: StreamingClaudeClient;
  requests: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const queue = [...rounds];
  return {
    requests,
    client: {
      streamMessage(params): MessageStreamHandle {
        requests.push(structuredClone(params));
        const round = queue.shift();
        if (!round) throw new Error("fake streaming client ran out of rounds");
        return {
          textDeltas: (async function* () {
            for (const delta of round.deltas) yield delta;
          })(),
          finalMessage: () => Promise.resolve(round.final),
        };
      },
    },
  };
}
