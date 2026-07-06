import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Chat } from "@/components/chat/chat";

// Component-level tests for the streaming client's failure-prone seams:
// result→chip pairing, unmount abort, and the Ask-AI nonce. The server is a
// mocked fetch returning a scripted NDJSON body.

function ndjsonResponse(lines: unknown[]): Response {
  const body = lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

const doneEvent = {
  type: "done",
  usage: { inputTokens: 10, outputTokens: 20 },
  stopReason: "end_turn",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Chat", () => {
  it("pairs tool results to chips by id, not name (same tool called twice)", async () => {
    // Two get_location_details calls; the FIRST succeeds, the SECOND fails.
    // A name-based match resolved LIFO and pinned the ✗ on the first chip.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([
        { type: "tool_start", id: "tu_1", name: "get_location_details", input: {} },
        { type: "tool_start", id: "tu_2", name: "get_location_details", input: {} },
        { type: "tool_result", id: "tu_1", name: "get_location_details", ok: true, output: null },
        { type: "tool_result", id: "tu_2", name: "get_location_details", ok: false, error: "x" },
        { type: "text_delta", text: "Answer." },
        doneEvent,
      ]),
    );

    render(<Chat askSignal={{ question: "Tell me about Austin and Dallas", nonce: 1 }} />);

    await waitFor(() => expect(screen.getByText("Answer.")).toBeDefined());
    const chips = screen.getAllByText("Fetching location details");
    expect(chips).toHaveLength(2);
    // Chips render in call order; the failure belongs to the SECOND call.
    expect(chips[0]!.parentElement!.textContent).toContain("✓");
    expect(chips[1]!.parentElement!.textContent).toContain("✗");
  });

  it("aborts the in-flight request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    // A fetch that never resolves — the stream is mid-flight when we unmount.
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    const { unmount } = render(<Chat askSignal={{ question: "long question", nonce: 1 }} />);
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal!.aborted).toBe(false);

    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("drops (not defers) an Ask-AI signal that lands mid-stream", async () => {
    // First send hangs until we release it; a second askSignal arrives while
    // streaming. Releasing the first stream must NOT auto-fire the second
    // question — the old behavior silently queued a paid API call.
    let release!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
      .mockImplementation(() => Promise.resolve(ndjsonResponse([doneEvent])));

    const { rerender } = render(<Chat askSignal={{ question: "first", nonce: 1 }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Mid-stream click elsewhere on the dashboard.
    rerender(<Chat askSignal={{ question: "second", nonce: 2 }} />);

    release(ndjsonResponse([{ type: "text_delta", text: "First answer." }, doneEvent]));
    await waitFor(() => expect(screen.getByText("First answer.")).toBeDefined());

    // Give any (buggy) deferred send a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
