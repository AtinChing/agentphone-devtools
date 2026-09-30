"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyActivity } from "@/lib/types";

/**
 * Series colors, stepped from the console's green/blue/purple so adjacent
 * bars stay distinguishable under color-vision deficiency on the dark
 * panel (validated: worst adjacent CVD ΔE 10.4, all ≥ 3:1 contrast).
 */
export const USAGE_SERIES = [
  { key: "messages", label: "Messages", color: "#4aa85e" },
  { key: "calls", label: "Calls", color: "#2d6ae0" },
  { key: "deliveries", label: "Webhooks", color: "#b27ff2" }
] as const;

const HEIGHT = 260;
const MARGIN = { top: 14, right: 8, bottom: 30, left: 40 };
const GAP = 2;
const MAX_BAR = 24;
const GRID = "#2d2d2a";
const AXIS_TEXT = "#9c9b93";
const TOOLTIP_WIDTH = 180;

function niceScale(peak: number): { step: number; top: number } {
  if (peak <= 4) return { step: 1, top: 4 };
  const rough = peak / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= rough) ?? rough;
  return { step, top: Math.ceil(peak / step) * step };
}

/** Column with a 4px rounded data end and a square baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Grouped daily columns (messages, calls, webhook deliveries) on one integer axis. */
export function UsageChart({ days }: { days: DailyActivity[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const peak = Math.max(0, ...days.flatMap((day) => [day.messages, day.calls, day.deliveries]));
  const { step, top } = niceScale(peak);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = days.length ? plotWidth / days.length : 0;
  const barWidth = Math.max(2, Math.min(MAX_BAR, (slot * 0.72 - GAP * 2) / USAGE_SERIES.length));
  const groupWidth = barWidth * USAGE_SERIES.length + GAP * (USAGE_SERIES.length - 1);
  const yOf = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const labelEvery = days.length > 14 ? 5 : 1;
  const hovered = hover === null ? null : days[hover];
  // The tooltip sits beside the hovered day so it never covers that day's bars.
  const slotRight = hover === null ? 0 : MARGIN.left + slot * (hover + 1);
  const tooltipLeft =
    hover === null ? 0 : slotRight + 8 + TOOLTIP_WIDTH <= width ? slotRight + 8 : Math.max(0, slotRight - slot - 8 - TOOLTIP_WIDTH);

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Daily messages, calls and webhook deliveries over the last ${days.length} days; peak ${peak} in a day.`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={yOf(tick)} y2={yOf(tick)} stroke={GRID} strokeWidth={1} />
              <text x={MARGIN.left - 10} y={yOf(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {tick.toLocaleString()}
              </text>
            </g>
          ))}

          {days.map((day, index) => {
            const slotX = MARGIN.left + slot * index;
            const groupX = slotX + (slot - groupWidth) / 2;
            const showLabel = (days.length - 1 - index) % labelEvery === 0;
            return (
              <g key={day.date}>
                {hover === index ? <rect x={slotX + 1} y={MARGIN.top} width={Math.max(0, slot - 2)} height={plotHeight} rx={6} fill="#242422" /> : null}
                {USAGE_SERIES.map((series, seriesIndex) => {
                  const value = day[series.key];
                  if (value <= 0) return null;
                  const height = Math.max(2, (value / top) * plotHeight);
                  const x = groupX + seriesIndex * (barWidth + GAP);
                  return <path key={series.key} d={barPath(x, MARGIN.top + plotHeight - height, barWidth, height)} fill={series.color} />;
                })}
                {showLabel ? (
                  <text x={slotX + slot / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                    {dayLabel(day.date)}
                  </text>
                ) : null}
                <rect
                  x={slotX}
                  y={MARGIN.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHover(index)}
                >
                  <title>{`${dayLabel(day.date)}: ${day.messages} messages · ${day.calls} calls · ${day.deliveries} webhooks`}</title>
                </rect>
              </g>
            );
          })}

          {peak === 0 ? (
            <text x={MARGIN.left + plotWidth / 2} y={MARGIN.top + plotHeight / 2} textAnchor="middle" fontSize={13} fill={AXIS_TEXT}>
              No activity in this range yet
            </text>
          ) : null}
        </svg>
      ) : null}

      {hovered ? (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-xl border border-line bg-raised px-3.5 py-2.5 shadow-soft"
          style={{ left: tooltipLeft, width: TOOLTIP_WIDTH }}
        >
          <div className="mb-1.5 text-[12px] font-semibold text-bright">{dayLabel(hovered.date)}</div>
          {USAGE_SERIES.map((series) => (
            <div key={series.key} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="flex items-center gap-2 text-slate-600">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: series.color }} />
                {series.label}
              </span>
              <span className="data font-semibold text-bright">{hovered[series.key]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
