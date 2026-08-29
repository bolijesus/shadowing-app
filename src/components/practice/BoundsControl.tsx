"use client";

import * as React from "react";
import { Button } from "@/components/ui/primitives";
import { fmtClock } from "@/lib/util";
import {
  NUDGE_STEP_SEC,
  planNudge,
  type Bounds,
  type NudgePlan,
} from "@/lib/practice/roundBounds";

/**
 * Ajuste a mano del tramo de la frase, dentro de la práctica.
 *
 * El afinado automático estira el corte hasta el primer silencio, pero cuando
 * el diálogo va encabalgado no hay silencio al que estirarse. Aquí se toca la
 * frase concreta, oyendo el resultado al momento.
 *
 * Mover un lado mueve la FRONTERA con la ronda vecina: si alargas el final,
 * la siguiente arranca donde acaba esta. Así nada se oye dos veces.
 *
 * `+` significa siempre MÁS audio por ese lado: el inicio se va hacia atrás y
 * el final hacia delante. Los botones se deshabilitan cuando ya no se puede
 * mover —borde del recorte, o la vecina se quedaría sin nada—, en vez de
 * aceptar un clic que no hace nada.
 */
export function BoundsControl({
  self,
  prev,
  next,
  clip,
  manual,
  onNudge,
  onReset,
}: {
  self: Bounds;
  /** Tramo efectivo de la ronda anterior, si la hay. */
  prev: Bounds | null;
  /** Tramo efectivo de la ronda siguiente, si la hay. */
  next: Bounds | null;
  clip: Bounds;
  /** ¿Hay algo fijado a mano que se pueda deshacer? */
  manual: boolean;
  onNudge: (side: "start" | "end", plan: NudgePlan) => void;
  onReset: () => void;
}) {
  const plan = React.useCallback(
    (side: "start" | "end", deltaSec: number) =>
      planNudge({
        side,
        deltaSec,
        self,
        neighbour: side === "start" ? prev : next,
        clip,
      }),
    [self, prev, next, clip],
  );

  const durationSec = Math.max(0, self.endSec - self.startSec);

  return (
    <div className="rounded-xl border-2 border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-soft">
          Tramo de la frase{" "}
          <span className="font-mono font-bold text-ink">
            {fmtClock(self.startSec)}–{fmtClock(self.endSec)}
          </span>{" "}
          · {durationSec.toFixed(1).replace(".", ",")} s
        </p>
        {manual && (
          <Button variant="ghost" size="xs" onClick={onReset}>
            Automático
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Side
          label="Inicio"
          less={{
            label: "−",
            hint: `Empezar ${step()} después`,
            plan: plan("start", -NUDGE_STEP_SEC),
          }}
          more={{
            label: "+",
            hint: `Empezar ${step()} antes`,
            plan: plan("start", NUDGE_STEP_SEC),
          }}
          onNudge={(p) => onNudge("start", p)}
        />
        <Side
          label="Final"
          less={{
            label: "−",
            hint: `Terminar ${step()} antes`,
            plan: plan("end", -NUDGE_STEP_SEC),
          }}
          more={{
            label: "+",
            hint: `Terminar ${step()} después`,
            plan: plan("end", NUDGE_STEP_SEC),
          }}
          onNudge={(p) => onNudge("end", p)}
        />
      </div>
    </div>
  );
}

function step(): string {
  return `${NUDGE_STEP_SEC.toFixed(2).replace(".", ",")} s`;
}

interface Nudge {
  label: string;
  hint: string;
  plan: NudgePlan | null;
}

function Side({
  label,
  less,
  more,
  onNudge,
}: {
  label: string;
  less: Nudge;
  more: Nudge;
  onNudge: (plan: NudgePlan) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-bold text-ink-soft">{label}</span>
      {[less, more].map((n) => (
        <Button
          key={n.label}
          variant="outline"
          size="xs"
          className="w-9 font-mono text-base leading-none"
          disabled={!n.plan}
          aria-label={n.hint}
          title={n.hint}
          onClick={() => n.plan && onNudge(n.plan)}
        >
          {n.label}
        </Button>
      ))}
    </div>
  );
}
