// Display formatting for tool outputs. Money is integer cents everywhere in
// the domain (ADR-001); conversion to dollars happens only here, at render.

const fullMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const preciseMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const fullCount = new Intl.NumberFormat("en-US");

const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "$9,432" below $10K, "$4.2M" above — the stat-tile auto-compact rule. */
export function formatMoneyCompact(cents: number): string {
  const dollars = cents / 100;
  return Math.abs(dollars) < 10_000 ? fullMoney.format(dollars) : compactMoney.format(dollars);
}

/** Full precision for table cells: "$495,479.11". */
export function formatMoneyExact(cents: number): string {
  return preciseMoney.format(cents / 100);
}

/** Small amounts that must keep cents (avg ticket): "$17.51". */
export function formatMoneyPrecise(cents: number): string {
  return preciseMoney.format(cents / 100);
}

/** "1,284" below 10K, "12.9K" above. */
export function formatCountCompact(value: number): string {
  return Math.abs(value) < 10_000 ? fullCount.format(value) : compactCount.format(value);
}

export function formatCountExact(value: number): string {
  return fullCount.format(value);
}

export function formatRating(rating: number | null): string {
  return rating === null ? "—" : `${rating.toFixed(2)} ★`;
}
