"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  COMPONENT_LABEL,
  type ComponentKey,
  type RoundScore,
} from "@/lib/scoring/scoreRound";
import { buildAdvice, scoreBasisLabel } from "@/lib/scoring/advice";

/** Cifra enorme en azul sobre panel claro, con /100 en gris (§12). */
export function BigScore({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-baseline rounded-xl bg-panel px-5 py-3",
        className,
      )}
    >
      <span className="h-display text-5xl text-data tabular-nums sm:text-6xl">
        {value}
      </span>
      <span className="ml-0.5 text-xl font-bold text-ink-soft">/100</span>
    </div>
  );
}

/** Tres tarjetas iguales para los componentes principales. */
const PRIMARY: ComponentKey[] = ["timing", "intonation"];
const SECONDARY: ComponentKey[] = ["durationMatch", "rhythmShape"];

const SECONDARY_LABEL: Record<string, string> = {
  durationMatch: "Duración medida",
  rhythmShape: "Forma rítmica medida",
};

export function ScoreBreakdown({ score }: { score: RoundScore }) {
  const primary = PRIMARY.filter((k) => score.present.includes(k));
  const secondary = SECONDARY.filter((k) => score.present.includes(k));
  const advice = buildAdvice(score);

  return (
    <div className="space-y-3">
      <BigScore value={score.total} />

      {primary.length > 0 && (
        <div
          className={cn(
            "grid gap-2",
            primary.length === 3
              ? "grid-cols-3"
              : primary.length === 2
                ? "grid-cols-2"
                : "grid-cols-1",
          )}
        >
          {primary.map((k) => (
            <div
              key={k}
              className="rounded-xl border-2 border-line bg-surface px-3 py-3"
            >
              <p className="text-xs font-semibold text-ink-soft">
                {COMPONENT_LABEL[k]}
              </p>
              <p className="h-display mt-1 text-2xl tabular-nums">
                {score.components[k]}
              </p>
            </div>
          ))}
        </div>
      )}

      {secondary.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {secondary.map((k) => (
            <div
              key={k}
              className="flex items-center justify-between rounded-lg border-2 border-line bg-surface px-3 py-2"
            >
              <span className="text-sm text-ink-soft">
                {SECONDARY_LABEL[k]}
              </span>
              <span className="text-sm font-bold tabular-nums">
                {score.components[k]}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-soft">{scoreBasisLabel(score)}</p>

      {advice && (
        <p className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-[15px] text-ink">
          {advice}
        </p>
      )}
    </div>
  );
}
