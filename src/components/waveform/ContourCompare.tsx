"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Las dos curvas de entonación superpuestas en un mismo gráfico.
 *
 * Hasta ahora modelo y toma se pintaban en paneles separados, y así no se ve
 * *dónde* te separas: hay que comparar dos dibujos de memoria. Encima, las
 * dos curvas ya vienen normalizadas en semitonos sobre la mediana de cada
 * hablante (§6.2), que es justo lo que permite superponer una voz grave y
 * una aguda sin que una quede fuera del gráfico.
 */
export function ContourCompare({
  model,
  take,
  height = 150,
  /** Fondo de escala en semitonos, para rotular el eje. */
  scaleSemitones = 8,
  progress,
  className,
  labels = { model: "Modelo", take: "Tú" },
}: {
  model: Float32Array | null;
  take?: Float32Array | null;
  height?: number;
  scaleSemitones?: number;
  /** 0–1: marca por dónde va la reproducción. */
  progress?: number;
  className?: string;
  labels?: { model: string; take: string };
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);

  React.useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width;
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
    const ink = css.getPropertyValue("--ink").trim() || "#16161a";
    const brand = css.getPropertyValue("--brand").trim() || "#f5402c";
    const line = css.getPropertyValue("--line-strong").trim() || "#a89e88";

    const pad = 10;
    const mid = height / 2;
    const amp = mid - pad;

    // Rejilla: centro y ±mitad de escala, para dar referencia de cuánto sube.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (const [frac, dashed] of [
      [0, false],
      [0.5, true],
      [-0.5, true],
    ] as const) {
      ctx.globalAlpha = dashed ? 0.35 : 0.6;
      ctx.setLineDash(dashed ? [3, 4] : []);
      const y = mid - frac * amp;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const draw = (
      data: Float32Array,
      color: string,
      lineWidth: number,
      alpha: number,
    ) => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < data.length; i++) {
        const v = data[i]!;
        if (Number.isNaN(v)) continue;
        pts.push({
          x: (i / Math.max(1, data.length - 1)) * width,
          y: mid - Math.max(-1, Math.min(1, v)) * amp,
        });
      }
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const c = pts[i]!;
        const n = pts[i + 1]!;
        ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2);
      }
      const last = pts[pts.length - 1]!;
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // El modelo va debajo y algo más grueso: es la referencia a seguir.
    if (model) draw(model, ink, 2.5, 0.85);
    if (take) draw(take, brand, 2, 1);

    if (progress !== undefined && progress > 0.001 && progress < 0.999) {
      ctx.strokeStyle = brand;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(progress * width, 0);
      ctx.lineTo(progress * width, height);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [model, take, width, height, progress]);

  return (
    <div ref={boxRef} className={cn("w-full space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
          Entonación
        </span>
        <div className="flex items-center gap-3 text-[11px] font-bold">
          <span className="flex items-center gap-1.5 text-ink">
            <span className="inline-block h-0.5 w-4 bg-ink" />
            {labels.model}
          </span>
          {take && (
            <span className="flex items-center gap-1.5 text-brand-ink">
              <span className="inline-block h-0.5 w-4 bg-brand" />
              {labels.take}
            </span>
          )}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          take
            ? "Curvas de entonación del modelo y de tu voz, superpuestas"
            : "Curva de entonación del modelo"
        }
        style={{ width: "100%", height }}
        className="rounded-lg border-2 border-line bg-panel"
      />
      <p className="text-[11px] text-ink-soft">
        Escala ±{scaleSemitones} semitonos sobre la voz de cada hablante, así
        que una voz grave y una aguda se pueden comparar directamente.
      </p>
    </div>
  );
}
