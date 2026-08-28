"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/util";
import type { Peaks } from "@/workers/audio-dsp.worker";

/**
 * Las dos ondas superpuestas, para ver dónde difieren el ritmo y la energía.
 *
 * Detalle que importa: las dos se dibujan en una escala de tiempo COMÚN, la
 * del más largo. Estirar cada una hasta llenar el ancho las alinearía a la
 * fuerza y escondería la diferencia de duración, que es justo lo que mide el
 * componente `durationMatch`. Así, si hablas más lento, tu onda se ve salir
 * por detrás de la del modelo, que es la información útil.
 */
export function WaveCompare({
  model,
  take,
  height = 130,
  className,
  labels = { model: "Modelo", take: "Tú" },
}: {
  model: Peaks | null;
  take?: Peaks | null;
  height?: number;
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

  const modelDur = model?.durationSec ?? 0;
  const takeDur = take?.durationSec ?? 0;
  const spanSec = Math.max(modelDur, takeDur) || 1;

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
    const gray = css.getPropertyValue("--line-strong").trim() || "#a89e88";
    const brand = css.getPropertyValue("--brand").trim() || "#f5402c";
    const ink = css.getPropertyValue("--ink").trim() || "#16161a";

    const mid = height / 2;
    const maxAmp = mid - 8;

    // Eje.
    ctx.strokeStyle = gray;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
    ctx.globalAlpha = 1;

    /** Ancho que ocupa una onda según su duración real frente al total. */
    const widthOf = (dur: number) => (dur / spanSec) * width;

    const silhouette = (p: Peaks, w: number) => {
      const step = w / p.buckets;
      const amp = (i: number) => {
        const mx = Math.abs(p.minmax[i * 2 + 1] ?? 0);
        const mn = Math.abs(p.minmax[i * 2] ?? 0);
        return Math.max(mx, mn, 0.01) * maxAmp;
      };
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i < p.buckets; i++)
        ctx.lineTo(i * step + step / 2, mid - amp(i));
      for (let i = p.buckets - 1; i >= 0; i--)
        ctx.lineTo(i * step + step / 2, mid + amp(i));
      ctx.closePath();
    };

    // El modelo va relleno detrás: es la referencia sobre la que te mides.
    if (model && model.buckets > 0) {
      silhouette(model, widthOf(modelDur));
      ctx.fillStyle = gray;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Tu toma va en contorno rojo encima, sin relleno, para no taparlo.
    if (take && take.buckets > 0) {
      silhouette(take, widthOf(takeDur));
      ctx.strokeStyle = brand;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Marca de dónde acaba el modelo, si tu toma se pasa o se queda corta.
    if (model && take && Math.abs(modelDur - takeDur) > 0.15) {
      const x = widthOf(modelDur);
      ctx.strokeStyle = ink;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }, [model, take, width, height, modelDur, takeDur, spanSec]);

  const diff = take ? takeDur - modelDur : 0;

  return (
    <div ref={boxRef} className={cn("w-full space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
          Ritmo y energía
        </span>
        <div className="flex items-center gap-3 text-[11px] font-bold">
          <span className="flex items-center gap-1.5 text-ink-soft">
            <span className="inline-block h-2 w-4 rounded-sm bg-line-strong" />
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
            ? "Ondas del modelo y de tu voz, superpuestas en la misma escala de tiempo"
            : "Onda del modelo"
        }
        style={{ width: "100%", height }}
        className="rounded-lg border-2 border-line bg-panel"
      />
      {take && Math.abs(diff) > 0.15 && (
        <p className="text-[11px] text-ink-soft">
          Tu toma dura {fmtClock(takeDur)} frente a {fmtClock(modelDur)} del
          modelo: {diff > 0 ? "vas más lento" : "vas más rápido"} por{" "}
          {Math.abs(diff).toFixed(1)} s. La línea de puntos marca dónde acaba
          el modelo.
        </p>
      )}
    </div>
  );
}
