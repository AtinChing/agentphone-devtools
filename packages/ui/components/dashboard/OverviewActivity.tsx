"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { DailyActivity } from "@/lib/types";
import { USAGE_SERIES } from "./UsageChart";
import { PillGroup } from "./RunsShared";

/**
 * The console Overview's "Activity" card: smooth lines for messages, calls
 * and webhook deliveries over a dashed grid, a range switch, and a hover
 * column with a tooltip. Series colors come from the Usage chart so both
 * tabs agree.
 */

type Range = "7d" | "30d";
const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 }
];

/** Vertical inset (percent of the plot) so the top and zero lines aren't clipped. */
const INSET = 3;

function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `${value}`;
}

/** Horizontal-tangent cubic curve through the points, as the console draws it. */
function smoothPath(points: [number, number][]): string {
  if (!points.length) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    const mid = (x0 + x1) / 2;
    d += ` C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
  }
  return d;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function OverviewActivity({ days, className = "" }: { days: DailyActivity[] | null; className?: string }) {
  const [range, setRange] = useState<Range>("30d");
  const [hover, setHover] = useState<number | null>(null);
  const span = RANGES.find((option) => option.id === range)!;
  const data = useMemo(() => (days ?? []).slice(-span.days), [days, span.days]);
  const count = data.length;
  const peak = Math.max(0, ...data.flatMap((day) => USAGE_SERIES.map((series) => day[series.key])));
  const step = Math.max(1, niceStep(Math.max(1, peak) / 4));
  const top = step * 4;
  const xOf = (index: number) => (count <= 1 ? 50 : (index / (count - 1)) * 100);
  const yOf = (value: number) => INSET + (1 - value / top) * (100 - 2 * INSET);
  const every = Math.max(1, Math.ceil(count / 6));
  const ticks = data.map((day, index) => ({ index, date: day.date })).filter(({ index }) => index % every === 0 || index === count - 1);
  const hovered = hover === null ? null : data[hover];

  function track(event: MouseEvent<HTMLDivElement>) {
    if (!count) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))));
  }

  return (
    <div className={`relative flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px] ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-[18px] font-bold leading-tight text-white">Activity</h2>
          <p className="mt-1.5 text-[13px] leading-snug text-white/50">Daily usage over the last {span.label}</p>
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
          <PillGroup options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="relative w-10 shrink-0">
            {[4, 3, 2, 1, 0].map((tick) => (
              <span
                key={tick}
                className="absolute right-2 -translate-y-1/2 text-[12px] leading-none tabular-nums text-text-subtle"
                style={{ top: `${yOf(tick * step)}%` }}
              >
                {compact(tick * step)}
              </span>
            ))}
          </div>
          <div
            role="img"
            aria-label={`Activity chart of messages, calls and webhooks over the last ${span.label}; peak ${peak} in a day.`}
            className="relative min-h-0 min-w-0 flex-1"
            onMouseMove={track}
            onMouseLeave={() => setHover(null)}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              {[4, 3, 2, 1, 0].map((tick) => (
                <line
                  key={tick}
                  x1="0"
                  x2="100"
                  y1={yOf(tick * step)}
                  y2={yOf(tick * step)}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {USAGE_SERIES.map((series, seriesIndex) => {
                const points = data.map((day, index): [number, number] => [xOf(index), yOf(day[series.key])]);
                if (!points.length) return null;
                if (points.length === 1) return <circle key={series.key} cx={points[0][0]} cy={points[0][1]} r="2" fill={series.color} />;
                return (
                  <path
                    key={series.key}
                    d={smoothPath(points)}
                    fill="none"
                    stroke={series.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    // Webhooks is dashed so it never relies on hue alone next to Calls.
                    strokeDasharray={seriesIndex === 2 ? "5 4" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {peak === 0 && days ? (
              <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-white/40">No activity in this range yet</p>
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
                  className="pointer-events-none absolute top-1 z-10 rounded-[10px] border border-white/10 bg-[#0c0c0c]/95 px-3 py-2 shadow-lg"
                  style={{
                    left: `${xOf(hover)}%`,
                    transform: `translateX(${xOf(hover) < 18 ? "0%" : xOf(hover) > 82 ? "-100%" : "-50%"})`
                  }}
                >
                  <p className="mb-1.5 whitespace-nowrap text-[12px] font-medium leading-none text-white/90">{dayLabel(hovered.date)}</p>
                  {USAGE_SERIES.map((series) => (
                    <div key={series.key} className="flex items-center gap-2 text-[12px] leading-5">
                      <span className="size-2 rounded-full" style={{ background: series.color }} />
                      <span className="text-white/60">{series.label}</span>
                      <span className="ml-auto pl-3 font-medium tabular-nums text-white">{hovered[series.key]}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex pl-10">
          <div className="relative h-4 min-w-0 flex-1 text-[12px] leading-none text-text-subtle">
            {ticks.map(({ index, date }) => (
              <span
                key={index}
                className="absolute top-0 whitespace-nowrap"
                style={{ left: `${xOf(index)}%`, transform: `translateX(${xOf(index) < 6 ? "0%" : xOf(index) > 94 ? "-100%" : "-50%"})` }}
              >
                {dayLabel(date)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
