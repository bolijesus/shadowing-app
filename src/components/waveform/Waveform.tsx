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
    const accent = css.getPropertyValue("--brand").trim() || "#f5402c";
    const ink = css.getPropertyValue("--ink").trim() || "#14141a";
    const hot = tone === "recording" || tone === "playing";
    const mid = height / 2;
    const maxAmp = mid - 8;

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

    // Eje tenue de borde a borde.
    ctx.strokeStyle = gray;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Parte no reproducida.
    buildPath();
    ctx.save();
    ctx.beginPath();
    ctx.rect(progX, 0, width - progX, height);
    ctx.clip();
    buildPath();
    ctx.fillStyle = gray;
    ctx.globalAlpha = hot ? 0.35 : 0.6;
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

    // Línea de entonación (F0): un único trazo fino y continuo de borde a
    // borde. `contourForDisplay` ya entrega la curva sin huecos.
    if (f0 && f0.length > 1) {
      const toX = (i: number) => (i / (f0.length - 1)) * width;
      const toY = (v: number) =>
        mid - Math.max(-1, Math.min(1, v)) * (maxAmp * 0.62);

      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < f0.length; i++) {
        const v = f0[i]!;
        if (!Number.isNaN(v)) pts.push({ x: toX(i), y: toY(v) });
      }

      if (pts.length > 1) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.25;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        // Curva por puntos medios: suaviza sin desplazar el contorno real.
        for (let i = 1; i < pts.length - 1; i++) {
          const c = pts[i]!;
          const nx = pts[i + 1]!;
          ctx.quadraticCurveTo(c.x, c.y, (c.x + nx.x) / 2, (c.y + nx.y) / 2);
        }
        const last = pts[pts.length - 1]!;
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
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
      <canvas
        ref={canvasRef}
        role={onSeek ? "slider" : "img"}
        aria-label={label ? `Onda ${label}` : "Forma de onda"}
        style={{ width: "100%", height }}
        className="rounded-lg bg-panel"
        onClick={(e) => {
          if (!onSeek) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - rect.left) / rect.width);
        }}
      />
    </div>
  );
}
