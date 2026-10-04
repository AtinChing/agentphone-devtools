import type { SimulatedDelay } from "./types.js";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000
};

/**
 * Parse a simulated delay: a millisecond number, or a duration string made
 * of one or more `<number><unit>` parts (ms, s, m, h, d, w), e.g. "2d",
 * "1h30m", "90s". Throws on anything else so typos never silently mean zero.
 */
export function parseDuration(input: SimulatedDelay): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new Error(`Invalid duration: ${input}`);
    return Math.round(input);
  }
  const text = input.trim().toLowerCase();
  const parts = text.match(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g);
  if (!parts || parts.join("") !== text.replace(/\s+/g, "")) throw new Error(`Invalid duration: "${input}" (use e.g. 90s, 45m, 3h, 2d, 1h30m)`);
  return Math.round(
    parts.reduce((total, part) => {
      const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(part);
      if (!match) throw new Error(`Invalid duration: "${input}"`);
      return total + Number(match[1]) * UNIT_MS[match[2]];
    }, 0)
  );
}

/** Humanize milliseconds into the largest sensible unit: "2d", "3h", "45m", "90s". */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1_000;
  if (seconds < 120) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 120) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
