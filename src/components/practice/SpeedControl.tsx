"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Velocidades del prompt (§7.G y §13.4). */
export const SPEEDS = [0.7, 0.85, 1, 1.15] as const;

/**
 * Selector de velocidad. La reproducción usa `preservesPitch = true`, así
 * que el modelo no suena a ardilla y la entonación sigue siendo útil.
 */
export function SpeedControl({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Velocidad de reproducción"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border-2 border-line bg-surface p-1",
        className,
      )}
    >
      <span className="px-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
        Vel.
      </span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={cn(
            "min-w-11 rounded-md px-2 py-1.5 text-sm font-bold transition-colors disabled:opacity-40",
            value === s
              ? "bg-primary text-primary-foreground"
              : "text-ink-soft hover:bg-panel hover:text-ink",
          )}
        >
          {s === 1 ? "1×" : `${s}×`}
        </button>
      ))}
    </div>
  );
}
