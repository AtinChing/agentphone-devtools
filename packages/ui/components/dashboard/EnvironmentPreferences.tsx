"use client";

import { useEffect, useState } from "react";

export type AppearanceKey = "compact" | "reduceMotion";

const STORAGE_KEY = "agentphone-devtools.appearance";
const ATTRIBUTES: Record<AppearanceKey, string> = { compact: "data-compact", reduceMotion: "data-reduce-motion" };

export type Appearance = Record<AppearanceKey, boolean>;

function readAppearance(): Appearance {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Appearance>;
    return { compact: parsed.compact === true, reduceMotion: parsed.reduceMotion === true };
  } catch {
    return { compact: false, reduceMotion: false };
  }
}

function applyAppearance(appearance: Appearance) {
  for (const key of Object.keys(ATTRIBUTES) as AppearanceKey[]) {
    if (appearance[key]) document.documentElement.setAttribute(ATTRIBUTES[key], "");
    else document.documentElement.removeAttribute(ATTRIBUTES[key]);
  }
}

// Rules keyed on the root attributes, so any page mounting
// <AppearancePreferences /> honors the saved choices.
const APPEARANCE_CSS = `
[data-compact] td, [data-compact] th { padding-top: 0.4rem !important; padding-bottom: 0.4rem !important; }
[data-reduce-motion] *, [data-reduce-motion] *::before, [data-reduce-motion] *::after {
  animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important; scroll-behavior: auto !important;
}`;

/**
 * Applies the stored appearance preferences to <html> and injects the rules
 * that give them effect. Renders only a <style> tag; safe to mount more
 * than once (e.g. in the shell and on the Settings page).
 */
export function AppearancePreferences() {
  useEffect(() => applyAppearance(readAppearance()), []);
  return <style>{APPEARANCE_CSS}</style>;
}

/** Read/write the preferences: persisted to localStorage and applied immediately. */
export function useAppearance(): [Appearance, (key: AppearanceKey, value: boolean) => void] {
  const [appearance, setAppearance] = useState<Appearance>({ compact: false, reduceMotion: false });
  useEffect(() => setAppearance(readAppearance()), []);

  function update(key: AppearanceKey, value: boolean) {
    const next = { ...appearance, [key]: value };
    setAppearance(next);
    applyAppearance(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
  }

  return [appearance, update];
}
