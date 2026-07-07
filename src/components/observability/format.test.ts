// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatDurationMs, formatMicroUsd, formatTokens, formatWhen } from "./format";

describe("formatDurationMs", () => {
  it("renders sub-second values as whole milliseconds", () => {
    expect(formatDurationMs(250)).toBe("250 ms");
  });

  it("renders sub-minute values with one decimal", () => {
    expect(formatDurationMs(1500)).toBe("1.5 s");
    expect(formatDurationMs(59_400)).toBe("59.4 s");
  });

  it("never renders 60 in the seconds slot (rounds before branching)", () => {
    // 119.5s rounds to 120s — must roll over to "2m 0s", not "1m 60s".
    expect(formatDurationMs(119_500)).toBe("2m 0s");
    expect(formatDurationMs(119_400)).toBe("1m 59s");
  });

  it("crosses into the minutes format when rounding reaches a full minute", () => {
    // 59.95s rounds to 60s — "60.0 s" would contradict the branch above it.
    expect(formatDurationMs(59_950)).toBe("1m 0s");
  });
});

describe("formatMicroUsd", () => {
  it("renders em dash for null (span never reported cost)", () => {
    expect(formatMicroUsd(null)).toBe("—");
  });

  it("keeps fractional cents visible instead of rounding to $0.00", () => {
    expect(formatMicroUsd(1_050)).toBe("$0.0011");
    expect(formatMicroUsd(2_500_000)).toBe("$2.50");
  });
});

describe("formatTokens", () => {
  it("groups thousands", () => {
    expect(formatTokens(1_234_567)).toBe("1,234,567");
  });
});

describe("formatWhen", () => {
  it("renders in UTC regardless of the machine's timezone", () => {
    expect(formatWhen(new Date(Date.UTC(2026, 0, 5, 9, 30)))).toBe("Jan 5, 09:30 UTC");
  });
});
