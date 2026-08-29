"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SettingsState } from "@/lib/types";

const DEFAULTS: SettingsState = {
  targetLanguage: "en-US",
  ipaDialect: "en-us",
  defaultRate: 1,
  rounds: 3,
  passThreshold: 80,
  showText: "fade",
  theme: "system",
  fontSize: 16,
  usesHeadphones: null,
  karaoke: true,
  micLatencyOffsetMs: null,
  phraseTailMs: 0,
  phraseNudgeSec: 0.25,
  scoreWeights: {
    intonation: 0.25,
    timing: 0.2,
    rhythmShape: 0.15,
    durationMatch: 0.1,
  },
};

interface SettingsStore extends SettingsState {
  set<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void;
  reset(): void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => {
        set({ [key]: value } as Partial<SettingsStore>);
        if (key === "theme") applyTheme(value as SettingsState["theme"]);
        if (key === "fontSize") applyFontSize(value as number);
      },
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "shadowing.settings",
      partialize: (s) => {
        const { set: _s, reset: _r, ...rest } = s;
        void _s;
        void _r;
        return rest;
      },
    },
  ),
);

export function applyTheme(theme: SettingsState["theme"]) {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function applyFontSize(px: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-size", `${px}px`);
}

export { DEFAULTS as DEFAULT_SETTINGS };
