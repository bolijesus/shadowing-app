"use client";

import * as React from "react";
import { Waveform } from "./Waveform";
import type { Peaks } from "@/workers/audio-dsp.worker";

/**
 * Panel de onda con etiqueta (MODELO / TÚ) y el toggle
 * `Mostrar entonación` / `Ocultar entonación` (§6.2), como en las capturas.
 */
export function WaveformPanel({
  label,
  peaks,
  contour,
  progress = 0,
  tone = "reference",
  height = 120,
  showIntonation,
  onToggleIntonation,
  onSeek,
  durationSec,
}: {
  label: string;
  peaks: Peaks | null;
  contour?: Float32Array | null;
  progress?: number;
  tone?: "reference" | "playing" | "recording";
  height?: number;
  showIntonation?: boolean;
  onToggleIntonation?: () => void;
  /** Pinchar en la onda reproduce desde ese punto. */
  onSeek?: (ratio: number) => void;
  durationSec?: number;
}) {
  const canToggle = !!onToggleIntonation && !!contour;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
          {label}
        </span>
        {canToggle && (
          <button
            type="button"
            onClick={onToggleIntonation}
            aria-pressed={showIntonation}
            className="text-xs font-bold text-brand-ink underline underline-offset-4 hover:text-ink"
          >
            {showIntonation ? "Ocultar entonación" : "Mostrar entonación"}
          </button>
        )}
      </div>
      <Waveform
        peaks={peaks}
        progress={progress}
        tone={tone}
        height={height}
        f0={showIntonation ? (contour ?? null) : null}
        onSeek={onSeek}
        durationSec={durationSec}
      />
    </div>
  );
}
