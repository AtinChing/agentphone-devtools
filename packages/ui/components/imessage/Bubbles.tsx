"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CheckCheck, GitBranch, Loader2, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import type { StepExpectResult } from "@/lib/types";
import { AGENT_BUBBLE, separatorLabel, THREAD_BG, type ThreadChannel } from "./model";

/**
 * Bubble primitives for the Messages view. The tail is the classic
 * two-layer trick: a bubble-colored curve, masked by a background-colored
 * notch, so it matches Apple's shape without images.
 */
export function BubbleShape({
  side,
  color,
  textColor,
  tail,
  pop,
  highlight,
  faded,
  children
}: {
  side: "left" | "right";
  color: string;
  textColor: string;
  tail: boolean;
  pop?: boolean;
  highlight?: boolean;
  faded?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative max-w-[70%] rounded-[18px] px-3 py-[7px] text-[15px] leading-[20px] ${pop ? "animate-pop" : ""} ${
        highlight ? "ring-2 ring-white/70 ring-offset-2 ring-offset-[#161615]" : ""
      } ${faded ? "opacity-75" : ""}`}
      style={{ background: color, color: textColor, transformOrigin: side === "right" ? "bottom right" : "bottom left" }}
    >
      <span className="relative z-[1] block whitespace-pre-wrap break-words">{children}</span>
      {tail ? <BubbleTail side={side} color={color} /> : null}
    </div>
  );
}

function BubbleTail({ side, color }: { side: "left" | "right"; color: string }) {
  const right = side === "right";
  return (
    <>
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: -1.6,
          height: 16,
          transform: "translateY(-1.6px)",
          ...(right
            ? { right: -5.6, borderRight: `16px solid ${color}`, borderBottomLeftRadius: "12.8px 11.2px" }
            : { left: -5.6, borderLeft: `16px solid ${color}`, borderBottomRightRadius: "12.8px 11.2px" })
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: -1.6,
          height: 16,
          width: 10,
          background: THREAD_BG,
          transform: "translateY(-2px)",
          ...(right ? { right: -10, borderBottomLeftRadius: 8 } : { left: -10, borderBottomRightRadius: 8 })
        }}
      />
    </>
  );
}

/** The business is "typing": three staggered dots in a gray bubble. */
export function TypingBubble() {
  return (
    <div className="mt-3 flex w-full justify-start" aria-live="polite" aria-label="The business is typing">
      <div className="relative flex items-center gap-[5px] rounded-[18px] px-3.5 py-[11px] animate-pop" style={{ background: AGENT_BUBBLE, transformOrigin: "bottom left" }}>
        {[0, 180, 360].map((delay) => (
          <span key={delay} className="relative z-[1] h-[7px] w-[7px] animate-typing rounded-full bg-[#9c9b93]" style={{ animationDelay: `${delay}ms` }} />
        ))}
        <BubbleTail side="left" color={AGENT_BUBBLE} />
      </div>
    </div>
  );
}

export function DateSeparator({ iso }: { iso: string }) {
  const { day, time } = separatorLabel(iso);
  if (!day) return null;
  return (
    <div className="mb-1 mt-5 select-none text-center text-[11px] text-slate-500">
      <span className="font-semibold text-slate-600">{day}</span> {time}
    </div>
  );
}

export function DeliveredLabel({ channel, at }: { channel: ThreadChannel; at: string }) {
  if (channel === "whatsapp") {
    const time = new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return (
      <div className="mt-1 flex items-center gap-1 pr-1 text-[11px] font-medium text-slate-500">
        {time}
        <CheckCheck size={14} className="text-[#53bdeb]" aria-label="Delivered" />
      </div>
    );
  }
  return <div className="mt-1 pr-1 text-[11px] font-medium text-slate-500">{channel === "sms" ? "Sent as Text Message" : "Delivered"}</div>;
}

/** Handler actions + step expectations under an agent reply. */
export function ReplyMeta({ actions, results }: { actions: string[]; results?: StepExpectResult[] }) {
  if (!actions.length && !results?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 pl-3">
      {actions.map((action) => (
        <span key={action} className="data rounded-md border border-[#5a3b8a]/60 bg-[#2a1f40]/70 px-1.5 py-px text-[10.5px] leading-4 text-badgepurple" title="Handler action">
          {action}
        </span>
      ))}
      {results?.map((result) => (
        <span
          key={result.action}
          title={`Expected ${result.action} · observed ${result.observed.join(", ") || "none"}`}
          className={`data inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-[10.5px] leading-4 ${
            result.passed ? "bg-emerald-50 text-fern" : "bg-red-50 text-[#f08080]"
          }`}
        >
          {result.passed ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
          {result.action}
        </span>
      ))}
    </div>
  );
}

/** Round hover affordance beside a bubble. */
export function ForkButton({ onClick, active, label = "Fork from here" }: { onClick: () => void; active?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group/fork relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-400 transition hover:border-indigo-400 hover:text-indigo-700 focus:opacity-100 ${
        active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
    >
      <GitBranch size={13} />
      <span className="pointer-events-none absolute bottom-full mb-1.5 whitespace-nowrap rounded-md border border-line bg-[#2c2c2e] px-2 py-1 text-[11px] font-medium text-bright opacity-0 shadow-soft transition group-hover/fork:opacity-100">
        {label}
      </span>
    </button>
  );
}

export type ForkMode = "after" | "instead" | "seed";

const FORK_COPY: Record<ForkMode, { placeholder: string; description: string }> = {
  after: {
    placeholder: "What does the customer say next?",
    description: "Keeps this message and its reply, then continues with a new customer message."
  },
  instead: {
    placeholder: "What does the customer say instead?",
    description: "Rewinds to just before this message and sends a different one."
  },
  seed: {
    placeholder: "How does the customer reply?",
    description: "Keeps everything up to this business message. The reply reaches your handler with the same history."
  }
};

/** Inline "branch this conversation" card anchored under a bubble. */
export function ForkPopover({
  align,
  mode,
  onMode,
  insteadAllowed,
  busyExternally,
  onCancel,
  onSubmit
}: {
  align: "left" | "right";
  mode: ForkMode;
  onMode?: (mode: ForkMode) => void;
  insteadAllowed: boolean;
  busyExternally: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const copy = FORK_COPY[mode];

  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  async function submit() {
    if (busy || busyExternally) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <div
      ref={cardRef}
      className={`mt-2 w-[344px] max-w-full animate-pop rounded-2xl border border-line bg-panel p-3.5 shadow-soft ${align === "right" ? "self-end" : "self-start"}`}
      style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <GitBranch size={14} className="text-indigo-400" />
        <span className="text-[13px] font-semibold text-bright">
          {mode === "seed" ? "Branch from this message" : mode === "instead" ? "Branch with a different message" : "Branch this conversation after this message"}
        </span>
        <button type="button" onClick={onCancel} aria-label="Close" className="ml-auto text-slate-500 hover:text-bright">
          <X size={14} />
        </button>
      </div>
      {onMode && mode !== "seed" ? (
        <div className="mt-2.5 grid grid-cols-2 rounded-lg bg-raised p-0.5 text-[12px]">
          {(["after", "instead"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === "instead" && !insteadAllowed}
              onClick={() => onMode(option)}
              title={option === "instead" && !insteadAllowed ? "The first message of a run can only be replaced by starting a new conversation" : undefined}
              className={`rounded-md px-2 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === option ? "bg-[#3a3a38] text-bright shadow-sm" : "text-slate-500 hover:text-bright"
              }`}
            >
              {option === "after" ? "After this message" : "Instead of this"}
            </button>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-[12px] leading-[17px] text-slate-500">{copy.description}</p>
      <input
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={copy.placeholder}
        className="mt-2.5 h-9 w-full rounded-full border border-line bg-raised px-3.5 text-[14px] text-bright outline-none placeholder:text-slate-400 focus:border-indigo-400"
      />
      {error ? <div className="mt-2 text-[12px] text-[#f08080]">{error}</div> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">{text.trim() ? "Sends to your handler right away" : "Leave empty to just open the branch"}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={onCancel} className="h-8 rounded-lg px-3 text-[13px] text-slate-600 hover:bg-mist hover:text-bright">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || busyExternally}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5b46c9] px-3 text-[13px] font-semibold text-white transition hover:bg-[#6a55d8] disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}
            Create branch
          </button>
        </div>
      </div>
    </div>
  );
}
