"use client";

/** Barra de progreso por segmentos, uno por ronda, rojo al completarse (§12). */
export function SegmentedProgress({
  total,
  done,
  current,
  onJump,
}: {
  total: number;
  done: boolean[];
  current: number;
  onJump?: (i: number) => void;
}) {
  return (
    <div className="flex gap-1" role="list" aria-label="Progreso de rondas">
      {Array.from({ length: total }).map((_, i) => {
        const Cmp = onJump ? "button" : "div";
        return (
          <Cmp
            key={i}
            role="listitem"
            aria-label={`Ronda ${i + 1}${done[i] ? " completada" : ""}`}
            onClick={onJump ? () => onJump(i) : undefined}
            className={[
              "h-1.5 flex-1 rounded-full transition-colors",
              done[i] ? "bg-brand" : i === current ? "bg-ink" : "bg-line",
            ].join(" ")}
          />
        );
      })}
    </div>
  );
}
