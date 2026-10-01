"use client";

import { useId, useState, type MouseEvent } from "react";
import type { DailyActivity } from "@/lib/types";

/** Series colors from the console's Activity chart: messages green, calls blue, webhooks purple. */
export const USAGE_SERIES = [
  { key: "messages", label: "Messages", color: "#26b65a" },
  { key: "calls", label: "Calls", color: "#3b82f6" },
  { key: "deliveries", label: "Webhooks", color: "#a855f7" }
] as const;

/** Vertical breathing room (in % of the plot) above the top gridline and below the baseline. */
const PAD = 4;

/** Smallest "nice" integer step (1, 2, 2.5, 5 × 10^n) that fits the peak in four intervals. */
function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= raw) ?? raw;
  return Math.max(1, Math.ceil(step));
}

function axisLabel(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Monotone cubic (Fritsch–Carlson) through the points, so lines never dip below zero between days. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]) / h;
      tangent[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const third = dx[i] / 3;
    d += `C${x0 + third},${y0 + tangent[i] * third} ${x1 - third},${y1 - tangent[i + 1] * third} ${x1},${y1}`;
  }
  return d;
}

/**
 * The console's Activity plot: y-axis labels in a w-10 column, four dashed
 * gridlines, smooth lines with soft area fills, and a hover column with a
 * small tooltip card. `days` is the already-ranged series (oldest first).
 */
export function UsageChart({ days, height }: { days: DailyActivity[]; /** Plot height in px; omit to fill a flex parent. */ height?: number }) {
  const gradientId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const count = days.length;
  const peak = Math.max(0, ...days.flatMap((day) => [day.messages, day.calls, day.deliveries]));
  const step = niceStep(Math.max(1, peak) / 4);
  const top = step * 4;
  const xOf = (index: number) => (count <= 1 ? 50 : (index / (count - 1)) * 100);
  const yOf = (value: number) => PAD + (1 - value / top) * (100 - 2 * PAD);
  const tickEvery = Math.max(1, Math.ceil(count / 6));
  const ticks = days.map((day, index) => ({ index, date: day.date })).filter(({ index }) => index % tickEvery === 0 || index === count - 1);
  const hovered = hover === null ? null : days[hover];

  function track(event: MouseEvent<HTMLDivElement>) {
    if (!count) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={height ? "flex flex-none" : "flex min-h-[180px] flex-1"} style={height ? { height } : undefined}>
        <div className="relative w-10 shrink-0">
          {[4, 3, 2, 1, 0].map((tick) => (
            <span
              key={tick}
              className="absolute right-2 -translate-y-1/2 text-[12px] leading-none tabular-nums text-text-subtle"
              style={{ top: `${yOf(tick * step)}%` }}
            >
              {axisLabel(tick * step)}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`Activity chart of messages, calls and webhooks over the last ${count} days; peak ${peak} in a day.`}
          className="relative min-h-0 min-w-0 flex-1"
          onMouseMove={track}
          onMouseLeave={() => setHover(null)}
        >
          {[4, 3, 2, 1, 0].map((tick) => (
            <div
              key={tick}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/[0.06]"
              style={{ top: `${yOf(tick * step)}%` }}
            />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              {USAGE_SERIES.map((series) => (
                <linearGradient key={series.key} id={`${gradientId}-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series.color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {USAGE_SERIES.map((series) => {
              const points = days.map((day, index): [number, number] => [xOf(index), yOf(day[series.key])]);
              if (points.length === 1) {
                return <circle key={series.key} cx={points[0][0]} cy={points[0][1]} r="2" fill={series.color} vectorEffect="non-scaling-stroke" />;
              }
              const line = smoothPath(points);
              if (!line) return null;
              const area = `${line}L${points[points.length - 1][0]},${yOf(0)}L${points[0][0]},${yOf(0)}Z`;
              return (
                <g key={series.key}>
                  <path d={area} fill={`url(#${gradientId}-${series.key})`} stroke="none" />
                  <path
                    d={line}
                    fill="none"
                    stroke={series.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>

          {peak === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-white/50">
              No activity in this range yet
            </div>
          ) : null}

          {hover !== null && hovered ? (
            <>
              <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/15" style={{ left: `${xOf(hover)}%` }} />
              {USAGE_SERIES.map((series) => (
                <span
                  key={series.key}
                  className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black/30"
                  style={{ left: `${xOf(hover)}%`, top: `${yOf(hovered[series.key])}%`, background: series.color }}
                />
              ))}
              <div
                className="pointer-events-none absolute top-1 z-10 min-w-[148px] rounded-[10px] border border-surface-border bg-surface px-3 py-2 text-xs shadow-lg"
                style={{
                  left: `${xOf(hover)}%`,
                  transform: `translateX(${xOf(hover) < 18 ? "8px" : xOf(hover) > 82 ? "calc(-100% - 8px)" : "-50%"})`
                }}
              >
                <p className="mb-1.5 text-[12px] font-medium leading-none text-white/90">{dayLabel(hovered.date)}</p>
                {USAGE_SERIES.map((series) => (
                  <div key={series.key} className="flex items-center gap-2 text-[12px] leading-5">
                    <span className="size-2 rounded-full" style={{ background: series.color }} />
                    <span className="text-white/60">{series.label}</span>
                    <span className="ml-auto pl-3 font-medium tabular-nums text-white">{hovered[series.key].toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="relative ml-10 mt-3 h-4">
        {ticks.map(({ index, date }) => {
          const x = xOf(index);
          const shift = index === 0 ? "0%" : index === count - 1 ? "-100%" : "-50%";
          return (
            <span
              key={date}
              className="absolute top-0 whitespace-nowrap text-[12px] leading-none tabular-nums text-text-subtle"
              style={{ left: `${x}%`, transform: `translateX(${shift})` }}
            >
              {dayLabel(date)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Activity card, as on the console: heading-face title, dim subtitle,
 * dot legend, and a range pill group over the line chart.
 */
export function ActivityCard({
  days,
  ranges = [7, 14, 30],
  defaultRange = 30,
  height,
  className = ""
}: {
  days: DailyActivity[];
  ranges?: number[];
  defaultRange?: number;
  height?: number;
  className?: string;
}) {
  const [range, setRange] = useState(defaultRange);
  const visible = days.slice(-range);
  return (
    <div className={`relative flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px] ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-[18px] font-bold leading-tight text-white">Activity</h2>
          <p className="mt-1.5 text-[13px] leading-snug text-white/50">Daily usage over the last {range} days</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            {USAGE_SERIES.map((series) => (
              <span key={series.key} className="flex items-center gap-1.5 text-[13px] text-white/70">
                <span className="size-2 rounded-full" style={{ background: series.color }} />
                {series.label}
              </span>
            ))}
          </div>
          <div className="flex gap-1 rounded-[10px] bg-white/[0.04] p-1">
            {ranges.map((option) => {
              const active = option === range;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  aria-pressed={active}
                  className={`focus-ring rounded-[6px] px-3 py-1.5 text-[13px] leading-none transition-[transform,background-color,color] duration-150 active:scale-[0.96] ${
                    active ? "bg-white/10 font-medium text-white" : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {option} days
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <UsageChart days={visible} height={height} />
      </div>
    </div>
  );
}
