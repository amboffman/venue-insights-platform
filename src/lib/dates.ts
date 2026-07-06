/** Shared calendar-date validation. The ISO regex alone admits impossible
 * dates (2026-06-31), which reach Postgres as bound parameters and come back
 * as an opaque `date/time field value out of range` driver error — a 500 on
 * the dashboard, an unreadable failure for the model. Every layer that
 * accepts a YYYY-MM-DD string validates through here so "format-valid but
 * not a real date" is caught where a graceful fallback is still possible. */

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a format-valid string naming a real calendar date.
 * A Date.UTC round-trip rejects impostors: JS normalizes 2026-06-31 to
 * July 1, so the components no longer match what was written. */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}
