// Display formatting for telemetry values. Cost is integer MICROdollars
// (ADR-0006) — deliberately not reusing the chat tool-views formatters,
// which take integer CENTS; sharing them would be a silent 10,000× error.

const microMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  // API calls cost fractions of a cent — two decimals would round a
  // 1,050µ$ call to "$0.00" and make the whole column look free.
  maximumFractionDigits: 4,
});

export function formatMicroUsd(microUsd: number | null): string {
  return microUsd === null ? "—" : microMoney.format(microUsd / 1_000_000);
}

const fullCount = new Intl.NumberFormat("en-US");

export function formatTokens(value: number): string {
  return fullCount.format(value);
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// UTC on purpose: a dev dashboard read from multiple machines should not
// render the same span at different times.
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatWhen(date: Date): string {
  return `${dateTime.format(date)} UTC`;
}
