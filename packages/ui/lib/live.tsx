"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, SERVER_URL } from "@/lib/api";
import type { Contact, InspectorDelivery, InspectorSession, InspectorSessionSummary, StepState, VoiceSupport } from "@/lib/types";

/**
 * One live connection to the devtools server, shared by every dashboard
 * tab: the current session, saved runs, step-debugger state, voice support
 * and contacts. Server-sent events keep it current; the refresh functions
 * cover resources the server does not push.
 */
export interface LiveData {
  connected: boolean;
  session: InspectorSession | null;
  runs: InspectorSessionSummary[];
  step: StepState | null;
  voice: VoiceSupport;
  contacts: Contact[];
  lastDelivery: InspectorDelivery | null;
  refreshContacts: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  refreshStep: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const LiveContext = createContext<LiveData | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<InspectorSession | null>(null);
  const [runs, setRuns] = useState<InspectorSessionSummary[]>([]);
  const [step, setStep] = useState<StepState | null>(null);
  const [voice, setVoice] = useState<VoiceSupport>({ available: false });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lastDelivery, setLastDelivery] = useState<InspectorDelivery | null>(null);
  const mounted = useRef(true);

  const refreshContacts = useCallback(async () => {
    try {
      const list = await api.get<Contact[]>("/api/contacts");
      if (mounted.current) setContacts(list);
    } catch {
      /* server offline: keep the last known list */
    }
  }, []);
  const refreshRuns = useCallback(async () => {
    try {
      const list = await api.get<InspectorSessionSummary[]>("/api/history");
      if (mounted.current) setRuns(list);
    } catch {
      /* ignore */
    }
  }, []);
  const refreshStep = useCallback(async () => {
    try {
      const state = await api.get<StepState>("/api/step");
      if (mounted.current) setStep(state);
    } catch {
      /* ignore */
    }
  }, []);
  const refreshSession = useCallback(async () => {
    try {
      const state = await api.get<InspectorSession>("/api/state");
      if (mounted.current) setSession(state);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshSession();
    void refreshRuns();
    void refreshStep();
    void refreshContacts();
    api
      .get<VoiceSupport>("/api/voice")
      .then((support) => mounted.current && setVoice(support))
      .catch(() => undefined);

    const source = new EventSource(`${SERVER_URL}/api/events`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("state", (event) => setSession(JSON.parse((event as MessageEvent).data) as InspectorSession));
    source.addEventListener("history", (event) => setRuns(JSON.parse((event as MessageEvent).data) as InspectorSessionSummary[]));
    source.addEventListener("step", (event) => setStep(JSON.parse((event as MessageEvent).data) as StepState));
    source.addEventListener("delivery", (event) => setLastDelivery(JSON.parse((event as MessageEvent).data) as InspectorDelivery));
    return () => {
      mounted.current = false;
      source.close();
    };
  }, [refreshContacts, refreshRuns, refreshSession, refreshStep]);

  const value = useMemo<LiveData>(
    () => ({ connected, session, runs, step, voice, contacts, lastDelivery, refreshContacts, refreshRuns, refreshStep, refreshSession }),
    [connected, session, runs, step, voice, contacts, lastDelivery, refreshContacts, refreshRuns, refreshStep, refreshSession]
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveData {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive must be used inside LiveProvider");
  return value;
}
