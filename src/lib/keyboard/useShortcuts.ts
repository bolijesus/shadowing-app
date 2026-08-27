"use client";

import { useEffect } from "react";

export type ShortcutMap = Partial<{
  playPause: () => void; // Espacio
  record: () => void; // R
  prev: () => void; // ArrowLeft
  next: () => void; // ArrowRight
  loop: () => void; // L
  toggleText: () => void; // T
  toggleIpa: () => void; // I
}>;

/** Atajos de teclado del prompt §7. Se desactivan al escribir en un campo. */
export function useShortcuts(map: ShortcutMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          t.tagName === "SELECT")
      ) {
        return;
      }
      const run = (fn?: () => void) => {
        if (!fn) return;
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case " ":
        case "Spacebar":
          return run(map.playPause);
        case "r":
        case "R":
          return run(map.record);
        case "ArrowLeft":
          return run(map.prev);
        case "ArrowRight":
          return run(map.next);
        case "l":
        case "L":
          return run(map.loop);
        case "t":
        case "T":
          return run(map.toggleText);
        case "i":
        case "I":
          return run(map.toggleIpa);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map, enabled]);
}
