"use client";

import * as React from "react";
import type { Peaks } from "@/workers/audio-dsp.worker";

type Tone = "reference" | "playing" | "recording";

/**
 * Forma de onda en Canvas propio (§2, §12). Gris de referencia, rojo al
 * sonar o grabar, con devicePixelRatio. Sin wavesurfer.
 */
export function Waveform({
  peaks,
  progress = 0,
  tone = "reference",
  height = 96,
  label,
  onSeek,
}: {
  peaks: Peaks | null;
  progress?: number;
  tone?: Tone;
  height?: number;
  label?: string;
  onSeek?: (ratio: number) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);

  React.useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue("--ink-soft").trim() || "#6b6862";
    const accent = css.getPropertyValue("--accent").trim() || "#f5402c";
    const played =
      tone === "recording" || tone === "playing" ? accent : css.getPropertyValue("--ink").trim();

    const mid = height / 2;

    if (!peaks || peaks.buckets === 0) {
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    const n = peaks.buckets;
    const step = width / n;
    const progX = progress * width;

    for (let i = 0; i < n; i++) {
      const mn = peaks.minmax[i * 2] ?? 0;
      const mx = peaks.minmax[i * 2 + 1] ?? 0;
      const x = i * step;
      const y1 = mid - mx * (mid - 2);
      const y2 = mid - mn * (mid - 2);
      ctx.strokeStyle = x <= progX ? played : line;
      ctx.globalAlpha = x <= progX ? 1 : 0.55;
      ctx.lineWidth = Math.max(1, step * 0.7);
      ctx.beginPath();
      ctx.moveTo(x + step / 2, y1);
      ctx.lineTo(x + step / 2, Math.max(y2, y1 + 0.5));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (progress > 0 && progress < 1) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(progX, 0);
      ctx.lineTo(progX, height);
      ctx.stroke();
    }
  }, [peaks, progress, tone, width, height]);

  return (
    <div ref={boxRef} className="relative w-full">
      {label && (
        <span className="absolute left-2 top-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
          {label}
        </span>
      )}
      <canvas
        ref={canvasRef}
        role={onSeek ? "slider" : "img"}
        aria-label={label ? `Onda ${label}` : "Forma de onda"}
        style={{ width: "100%", height }}
        className="rounded-control bg-panel"
        onClick={(e) => {
          if (!onSeek) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - rect.left) / rect.width);
        }}
      />
    </div>
  );
}
