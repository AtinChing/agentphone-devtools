"use client";

import { GitBranch, Search, SquarePen, X } from "lucide-react";
import { Avatar } from "@/components/dashboard/ui";
import { CHANNELS, LIST_BG, listTime, type ThreadChannel, type ThreadGroup, type ThreadRow } from "./model";

/**
 * The Messages sidebar: search, the new-message pen, and one row per run
 * (grouped under a contact header when that contact has several runs).
 */
export function ThreadList({
  groups,
  selectedKey,
  query,
  onQuery,
  onSelect,
  onNew,
  composing,
  connected
}: {
  groups: ThreadGroup[];
  selectedKey: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (row: ThreadRow) => void;
  onNew: () => void;
  /** A New Message draft in progress (shown as the top row, like Messages). */
  composing: { name?: string; channel: ThreadChannel } | null;
  connected: boolean;
}) {
  const empty = groups.length === 0;
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line" style={{ background: LIST_BG }}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onQuery("");
            }}
            placeholder="Search"
            aria-label="Search conversations"
            className="h-8 w-full rounded-lg border border-transparent bg-[#232321] pl-8 pr-7 text-[13px] text-bright outline-none placeholder:text-slate-400 focus:border-[#1f8fff]/60"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-slate-400 text-[#121211]"
            >
              <X size={10} strokeWidth={3} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onNew}
          title="New message"
          aria-label="New message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-mist hover:text-bright"
        >
          <SquarePen size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {composing ? (
          <div className="relative mb-0.5 flex items-center gap-3 rounded-xl bg-mist px-3 py-2.5">
            <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full" style={{ background: CHANNELS[composing.channel].accent }} />
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3a3a38] text-slate-600">
              <SquarePen size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-bright">{composing.name ? `To: ${composing.name}` : "New Message"}</span>
              <span className="block text-[12.5px] text-slate-500">Draft</span>
            </span>
          </div>
        ) : null}

        {groups.map((group) => (
          <div key={group.key}>
            {group.header ? (
              <div className="flex items-baseline gap-2 px-3 pb-1 pt-3">
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{group.header.title}</span>
                {group.header.subtitle ? <span className="shrink-0 text-[11px] text-slate-400">{group.header.subtitle}</span> : null}
                <span className="ml-auto shrink-0 text-[10.5px] text-slate-400">{group.header.count}</span>
              </div>
            ) : null}
            {group.rows.map((row) => (
              <ThreadRowButton key={row.key} row={row} selected={row.key === selectedKey} nested={Boolean(group.header)} onSelect={onSelect} />
            ))}
          </div>
        ))}

        {empty && !composing ? (
          <div className="px-6 py-14 text-center">
            <div className="text-[14px] font-semibold text-slate-700">{query ? "No Results" : "No Conversations"}</div>
            <div className="mt-1.5 text-[12.5px] leading-5 text-slate-500">
              {query
                ? `Nothing matches “${query}”.`
                : connected
                  ? "Start one with the pen button above."
                  : "Waiting for the devtools server…"}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function ThreadRowButton({ row, selected, nested, onSelect }: { row: ThreadRow; selected: boolean; nested: boolean; onSelect: (row: ThreadRow) => void }) {
  const style = CHANNELS[row.channel];
  const empty = row.kind === "draft";
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      aria-current={selected ? "true" : undefined}
      className={`relative mb-0.5 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        selected ? "bg-mist" : "hover:bg-white/[0.035]"
      }`}
    >
      {selected ? <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full" style={{ background: style.accent }} /> : null}
      <span className="relative mt-0.5 shrink-0">
        <Avatar name={row.name === "Unknown number" ? "#" : row.name} size={nested ? 36 : 40} />
        {row.live ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#34c759]"
            style={{ boxShadow: `0 0 0 2px ${selected ? "#242422" : LIST_BG}` }}
            title="Live conversation"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-[14px] font-semibold ${empty ? "text-slate-700" : "text-bright"}`}>{row.name}</span>
          <span className="ml-auto shrink-0 text-[12px] text-slate-400">{listTime(row.at)}</span>
        </span>
        <span className={`mt-0.5 line-clamp-2 break-words text-[13px] leading-[17px] ${empty ? "italic text-slate-400" : "text-slate-500"}`}>{row.preview}</span>
        <span className="mt-1 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: style.text }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: style.accent }} />
            {style.label}
          </span>
          {row.forkedFrom ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-indigo-400" title={`Forked ${row.forkedFrom.turnIndex === 0 ? "from the opener" : `after message ${row.forkedFrom.turnIndex}`}`}>
              <GitBranch size={10} />
              branch
            </span>
          ) : null}
          {row.live ? <span className="text-[10.5px] font-medium text-[#34c759]">live</span> : row.ended ? <span className="text-[10.5px] text-slate-400">ended</span> : null}
        </span>
      </span>
    </button>
  );
}
