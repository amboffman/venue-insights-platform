import { describe, expect, it } from "vitest";

import { isCalendarDate } from "./dates";

describe("isCalendarDate", () => {
  it("accepts real calendar dates", () => {
    expect(isCalendarDate("2026-01-01")).toBe(true);
    expect(isCalendarDate("2026-06-30")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects format-valid but impossible dates", () => {
    expect(isCalendarDate("2026-06-31")).toBe(false); // June has 30 days
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("0000-00-00")).toBe(false);
    expect(isCalendarDate("2027-02-29")).toBe(false); // not a leap year
  });

  it("rejects strings that are not even format-valid", () => {
    expect(isCalendarDate("2026-6-31")).toBe(false);
    expect(isCalendarDate("June 30, 2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});
