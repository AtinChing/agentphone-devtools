import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "../src/index.js";

describe("simulated durations", () => {
  it("parses numbers as milliseconds and unit strings as durations", () => {
    expect(parseDuration(1500)).toBe(1500);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("45m")).toBe(2_700_000);
    expect(parseDuration("3h")).toBe(10_800_000);
    expect(parseDuration("2d")).toBe(172_800_000);
    expect(parseDuration("1w")).toBe(604_800_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration(" 2D ")).toBe(172_800_000);
    expect(parseDuration("250ms")).toBe(250);
  });

  it("rejects typos instead of silently meaning zero", () => {
    expect(() => parseDuration("")).toThrow(/Invalid duration/);
    expect(() => parseDuration("soon")).toThrow(/Invalid duration/);
    expect(() => parseDuration("2 days")).toThrow(/Invalid duration/);
    expect(() => parseDuration("-1h")).toThrow(/Invalid duration/);
    expect(() => parseDuration(-5)).toThrow(/Invalid duration/);
    expect(() => parseDuration(Number.NaN)).toThrow(/Invalid duration/);
  });

  it("humanizes into the largest sensible unit and round-trips", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(90_000)).toBe("90s");
    expect(formatDuration(2_700_000)).toBe("45m");
    expect(formatDuration(10_800_000)).toBe("3h");
    expect(formatDuration(864_000_000)).toBe("10d");
    for (const input of ["90s", "45m", "3h", "10d"]) {
      expect(parseDuration(formatDuration(parseDuration(input)))).toBe(parseDuration(input));
    }
  });
});
