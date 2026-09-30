"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, CircleAlert, Loader2, Megaphone, Mic, Square } from "lucide-react";
import { errorMessage } from "@/lib/api";
import type { StepQueueTurn } from "@/lib/types";
import { CHANNELS, formatOffset, THREAD_BG, type ThreadChannel } from "./model";
import { useDictation } from "./useDictation";

/**
 * The pill-shaped message field. Enter sends, Shift+Enter breaks a line; the
 * mic dictates into the field, and holding Space (focus outside any field)
 * records and sends on release. A scripted next turn from the step queue is
 * surfaced above the field so scenario runs can be stepped from here too.
 */
export function ComposeBar({
  channel,
  sending,
  voiceAvailable,
  queued,
  disabled,
  disabledHint,
  onSend,
  onSkipQueued
}: {
  channel: ThreadChannel;
  /** A turn is in flight: sending is paused until the reply lands. */
  sending: boolean;
  voiceAvailable: boolean;
  queued?: StepQueueTurn | null;
  disabled?: boolean;
  disabledHint?: string;
  /** Empty text sends the queued turn as-is. */
  onSend: (text: string) => Promise<void>;
  onSkipQueued?: () => Promise<void>;
}) {
  const style = CHANNELS[channel];
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function submit(raw: string) {
    const value = raw.trim();
    if (disabled) return;
    if (sending || busy) {
      // A dictated turn landed mid-reply: keep it rather than dropping it.
      if (value) {
        setText(value);
        setError("Still waiting on the last reply. Press Enter to send once it lands.");
      }
      return;
    }
    if (!value && !queued) return;
    setError(null);
    setBusy(true);
    setText("");
    try {
      await onSend(value);
    } catch (failure) {
      setError(errorMessage(failure));
      if (value) setText(value);
    } finally {
      setBusy(false);
    }
  }

  const dictation = useDictation({
    available: voiceAvailable && !disabled,
    holdToTalk: true,
    onTranscript: (heard) => {
      setText(heard);
      inputRef.current?.focus();
    },
    onAutoSend: (heard) => submit(heard)
  });

  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [text]);

  const canSend = !disabled && !sending && !busy && (text.trim().length > 0 || Boolean(queued));
  const recording = dictation.state === "recording";
  const transcribing = dictation.state === "transcribing";
  const shownError = error ?? dictation.error;
  const placeholder = disabled
    ? disabledHint ?? style.placeholder
    : recording
      ? dictation.holding
        ? "Listening… release Space to send"
        : "Listening… click the mic to stop"
      : transcribing
        ? "Transcribing…"
        : queued?.caller
          ? `${queued.caller}  (press Enter to send the scripted turn)`
          : style.placeholder;

  return (
    <div className="shrink-0 px-4 pb-3 pt-2" style={{ background: THREAD_BG }}>
      {queued && !disabled ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 text-[12.5px]">
          <span className="micro shrink-0 text-slate-500">Next</span>
          {queued.agent !== undefined ? <Megaphone size={12} className="shrink-0 text-slate-500" /> : null}
          <span className="min-w-0 flex-1 truncate text-slate-700">
            {queued.agent !== undefined ? `Business: “${queued.agent}”` : `“${queued.caller ?? ""}”`}
          </span>
          {queued.after !== undefined ? (
            <span className="shrink-0 text-[11px] text-caution">after {typeof queued.after === "number" ? formatOffset(queued.after).replace("+", "") : queued.after}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void submit("")}
            disabled={sending || busy}
            className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold text-bright hover:bg-mist disabled:opacity-40"
          >
            Send
          </button>
          {onSkipQueued ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                onSkipQueued().catch((failure) => setError(errorMessage(failure)));
              }}
              disabled={sending || busy}
              className="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-slate-500 hover:bg-mist hover:text-bright disabled:opacity-40"
            >
              Skip
            </button>
          ) : null}
        </div>
      ) : null}

      {shownError ? (
        <div className="mb-1.5 flex items-center gap-1.5 px-3 text-[12px] text-[#f08080]" role="alert">
          <CircleAlert size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={shownError}>
            {shownError}
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              dictation.clearError();
            }}
            className="shrink-0 text-[11px] text-slate-500 hover:text-bright"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div
        className={`flex items-end gap-1.5 rounded-[22px] border bg-[#1d1d1c] py-1 pl-1.5 pr-1 transition ${
          recording ? "border-[#ff453a]/70" : "border-[#383835] focus-within:border-[#4c4c48]"
        } ${disabled ? "opacity-60" : ""}`}
      >
        {voiceAvailable ? (
          <button
            type="button"
            onClick={() => void dictation.toggle()}
            disabled={disabled || transcribing}
            title={recording ? "Stop dictation" : "Dictate (or hold Space)"}
            aria-label={recording ? "Stop dictation" : "Dictate message"}
            className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
              recording ? "bg-[#ff453a] text-white" : "text-slate-500 hover:bg-mist hover:text-bright"
            }`}
          >
            {transcribing ? <Loader2 size={16} className="animate-spin" /> : recording ? <Square size={11} fill="currentColor" /> : <Mic size={17} />}
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit(text);
            }
            if (event.key === "Escape") (event.target as HTMLTextAreaElement).blur();
          }}
          placeholder={placeholder}
          aria-label={`${style.placeholder} message`}
          className={`min-h-[32px] flex-1 resize-none bg-transparent px-1 py-[6px] text-[15px] leading-5 text-bright outline-none ${
            recording ? "placeholder:text-[#ff6961]" : "placeholder:text-slate-400"
          }`}
        />
        <button
          type="button"
          onClick={() => void submit(text)}
          disabled={!canSend}
          aria-label="Send"
          title={sending ? "Waiting for the reply…" : "Send"}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-30"
          style={{ background: style.accent }}
        >
          {busy || sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.6} />}
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between px-3 text-[10.5px] text-slate-400">
        <span>
          Enter to send · Shift+Enter for a new line
          {voiceAvailable && !disabled ? " · hold Space (outside the field) to talk" : ""}
        </span>
        {recording && dictation.holding ? (
          <span className="flex items-center gap-1.5 font-medium text-[#ff6961]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff453a]" /> Recording
          </span>
        ) : null}
      </div>
    </div>
  );
}
