"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";

export type DictationState = "idle" | "recording" | "transcribing";

/**
 * Voice dictation for the compose bar, mirroring the Inspector: the mic
 * button records and fills the input for editing; holding Space (with focus
 * outside any text field) records and auto-sends on release. Transcription
 * runs on the local devtools server (POST /api/voice/transcribe). Handlers
 * read refs only, so the once-registered key listeners never go stale.
 */
export function useDictation({
  available,
  holdToTalk,
  onTranscript,
  onAutoSend
}: {
  available: boolean;
  holdToTalk: boolean;
  onTranscript: (text: string) => void;
  onAutoSend: (text: string) => Promise<void> | void;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<DictationState>("idle");
  const startingRef = useRef(false);
  const holdRef = useRef(false);
  const autoSendRef = useRef(false);
  const disposedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;

  const update = useCallback((next: DictationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const begin = useCallback(
    async (autoSend: boolean) => {
      if (stateRef.current !== "idle" || startingRef.current) return;
      startingRef.current = true;
      setError(null);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        startingRef.current = false;
        holdRef.current = false;
        setHolding(false);
        setError("Microphone unavailable or permission denied.");
        return;
      }
      autoSendRef.current = autoSend;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        if (disposedRef.current) return;
        if (Date.now() - startedAt < 350) {
          // A tap, not a hold: nothing worth transcribing.
          autoSendRef.current = false;
          setHolding(false);
          setError(autoSend ? "Hold Space while you talk, then release to send." : null);
          update("idle");
          return;
        }
        update("transcribing");
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const result = await api.postRaw<{ text?: string }>("/api/voice/transcribe", blob, blob.type.split(";")[0] || "audio/webm");
          const heard = (result?.text ?? "").trim();
          if (!heard) setError("Heard nothing. Try again or type the message.");
          else if (autoSendRef.current) await onAutoSendRef.current(heard);
          else onTranscriptRef.current(heard);
        } catch (failure) {
          setError(errorMessage(failure));
        } finally {
          autoSendRef.current = false;
          setHolding(false);
          update("idle");
        }
      };
      const startedAt = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      startingRef.current = false;
      update("recording");
      // Space released before the mic finished opening: stop right away.
      if (autoSend && !holdRef.current) recorder.stop();
    },
    [update]
  );

  /** Mic button: click to record, click again to stop and fill the input. */
  const toggle = useCallback(async () => {
    if (stateRef.current === "recording") {
      recorderRef.current?.stop();
      return;
    }
    await begin(false);
  }, [begin]);

  useEffect(() => {
    if (!available || !holdToTalk) return;
    const typingTarget = () => {
      const element = document.activeElement;
      return (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        (element instanceof HTMLElement && element.isContentEditable)
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey || typingTarget()) return;
      event.preventDefault();
      if (stateRef.current !== "idle" || startingRef.current) return;
      holdRef.current = true;
      setHolding(true);
      void begin(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !holdRef.current) return;
      event.preventDefault();
      holdRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [available, holdToTalk, begin]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    };
  }, []);

  return { state, holding, error, clearError: () => setError(null), toggle };
}
