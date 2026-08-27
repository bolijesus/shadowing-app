"use client";

import * as React from "react";
import type { Peaks } from "@/workers/audio-dsp.worker";

type Tone = "reference" | "playing" | "recording";

/**
 * Forma de onda en Canvas propio (§2, §12): silueta rellena en gris,
 * roja al sonar o grabar, con la porción reproducida marcada y una
 * línea de entonación opcional (negra fina). Sin wavesurfer.
 */
export function Waveform({
  peaks,
  progress = 0,
  tone = "reference",
  height = 110,
  label,
  f0 = null,
  onSeek,
}: {
  peaks: Peaks | null;
  progress?: number;
  tone?: Tone;
  height?: number;
  label?: string;
  /** Contorno de entonación normalizado a [-1, 1]; NaN = tramo sordo. */
  f0?: Float32Array | null;
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
    const gray = css.getPropertyValue("--line-strong").trim() || "#a69c86";
    const accent = css.getPropertyValue("--accent").trim() || "#f5402c";
    const ink = css.getPropertyValue("--ink").trim() || "#14141a";
    const hot = tone === "recording" || tone === "playing";
    const mid = height / 2;
    const maxAmp = mid - 6;

    if (!peaks || peaks.buckets === 0) {
      ctx.strokeStyle = gray;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    const n = peaks.buckets;
    const step = width / n;
    const progX = Math.max(0, Math.min(1, progress)) * width;

    // Silueta rellena (envolvente reflejada).
    const buildPath = () => {
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i < n; i++) {
        const mx = Math.abs(peaks.minmax[i * 2 + 1] ?? 0);
        const mn = Math.abs(peaks.minmax[i * 2] ?? 0);
        const amp = Math.max(mx, mn, 0.012) * maxAmp;
        ctx.lineTo(i * step + step / 2, mid - amp);
      }
      for (let i = n - 1; i >= 0; i--) {
        const mx = Math.abs(peaks.minmax[i * 2 + 1] ?? 0);
        const mn = Math.abs(peaks.minmax[i * 2] ?? 0);
        const amp = Math.max(mx, mn, 0.012) * maxAmp;
        ctx.lineTo(i * step + step / 2, mid + amp);
      }
      ctx.closePath();
    };

    // Parte no reproducida.
    buildPath();
    ctx.save();
    ctx.beginPath();
    ctx.rect(progX, 0, width - progX, height);
    ctx.clip();
    buildPath();
    ctx.fillStyle = gray;
    ctx.globalAlpha = hot ? 0.4 : 0.85;
    ctx.fill();
    ctx.restore();

    // Parte reproducida / grabada.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, progX, height);
    ctx.clip();
    buildPath();
    ctx.fillStyle = hot ? accent : ink;
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.restore();

    // Línea de entonación (F0).
    if (f0 && f0.length > 1) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < f0.length; i++) {
        const v = f0[i]!;
        const x = (i / (f0.length - 1)) * width;
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const y = mid - Math.max(-1, Math.min(1, v)) * (maxAmp * 0.8);
        if (!pen) {
          ctx.moveTo(x, y);
          pen = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Cursor de progreso.
    if (progress > 0.001 && progress < 0.999) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(progX, 0);
      ctx.lineTo(progX, height);
      ctx.stroke();
    }
  }, [peaks, progress, tone, width, height, f0]);

  return (
    <div ref={boxRef} className="relative w-full">
      {label && (
        <span className="absolute left-3 top-2 z-10 text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
          {label}
        </span>
      )}
      <canvas
        ref={canvasRef}
        role={onSeek ? "slider" : "img"}
        aria-label={label ? `Onda ${label}` : "Forma de onda"}
        style={{ width: "100%", height }}
        className="rounded-control border-2 border-line bg-panel"
        onClick={(e) => {
          if (!onSeek) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - rect.left) / rect.width);
        }}
      />
    </div>
  );
}
