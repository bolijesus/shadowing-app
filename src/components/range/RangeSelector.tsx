"use client";

import * as React from "react";
import { Button, TextInput } from "@/components/ui/primitives";
import { clamp, fmtClock, parseClock } from "@/lib/util";

/**
 * Selección de rango (§5): campos mm:ss, línea de tiempo con handles
 * arrastrables, botones ±1s / ±5s, previsualización. El recorte resultante
 * es virtual: {startSec, endSec}, cero bytes.
 */
export function RangeSelector({
  duration,
  start,
  end,
  onChange,
  onPreview,
  onScrub,
}: {
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onPreview?: () => void;
  /**
   * Se dispara mientras se arrastra un tirador. Sirve para llevar la
   * previsualización a ese segundo y poder localizar la escena a ojo, en vez
   * de tener que reproducir el rango cada vez para saber dónde estás.
   */
  onScrub?: (sec: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [startText, setStartText] = React.useState(fmtClock(start));
  const [endText, setEndText] = React.useState(fmtClock(end));

  React.useEffect(() => setStartText(fmtClock(start)), [start]);
  React.useEffect(() => setEndText(fmtClock(end)), [end]);

  // Cualquier forma de mover un extremo — arrastrar, ±1s/±5s o las flechas —
  // lleva también la previsualización a ese punto.
  const setStart = (v: number) => {
    const t = clamp(v, 0, end - 0.2);
    onChange(t, end);
    onScrub?.(t);
  };
  const setEnd = (v: number) => {
    const t = clamp(v, start + 0.2, duration);
    onChange(start, t);
    onScrub?.(t);
  };

  const drag = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const ratio = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const t = ratio * duration;
      if (which === "start") setStart(t);
      else setEnd(t);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pctStart = duration ? (start / duration) * 100 : 0;
  const pctEnd = duration ? (end / duration) * 100 : 100;

  return (
    <div className="space-y-3">
      <div
        ref={trackRef}
        className="relative h-12 w-full rounded-lg bg-panel"
        role="group"
        aria-label="Línea de tiempo del recorte"
      >
        <div
          className="absolute inset-y-0 rounded-lg bg-brand/20"
          style={{ left: `${pctStart}%`, right: `${100 - pctEnd}%` }}
        />
        {(["start", "end"] as const).map((which) => (
          <button
            key={which}
            aria-label={which === "start" ? "Inicio del recorte" : "Fin del recorte"}
            onPointerDown={drag(which)}
            onKeyDown={(e) => {
              const delta = e.shiftKey ? 5 : 1;
              if (e.key === "ArrowLeft")
                which === "start" ? setStart(start - delta) : setEnd(end - delta);
              if (e.key === "ArrowRight")
                which === "start" ? setStart(start + delta) : setEnd(end + delta);
            }}
            className="absolute top-1/2 h-10 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded bg-brand"
            style={{ left: `${which === "start" ? pctStart : pctEnd}%` }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["Inicio", startText, setStartText, (v: number) => setStart(v), start],
            ["Fin", endText, setEndText, (v: number) => setEnd(v), end],
          ] as const
        ).map(([label, text, setText, apply, value]) => (
          <div key={label}>
            <span className="mb-1 block text-xs font-semibold text-ink-soft">
              {label}
            </span>
            <TextInput
              inputMode="numeric"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                const s = parseClock(text);
                if (s != null) apply(s);
              }}
            />
            <div className="mt-1.5 flex gap-1">
              {[-5, -1, 1, 5].map((d) => (
                <button
                  key={d}
                  onClick={() => apply(value + d)}
                  className="flex-1 rounded border border-line py-1 text-xs font-semibold text-ink-soft hover:bg-panel"
                >
                  {d > 0 ? `+${d}` : d}s
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-ink-soft">
        <span>
          Duración del recorte:{" "}
          <strong className="text-ink">{fmtClock(end - start)}</strong>
        </span>
        {onPreview && (
          <Button variant="outline" onClick={onPreview}>
            Previsualizar rango
          </Button>
        )}
      </div>
    </div>
  );
}
