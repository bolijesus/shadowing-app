"use client";

import * as React from "react";
import { Button, TextInput } from "@/components/ui/primitives";
import { fmtClock } from "@/lib/util";
import {
  MAX_NUDGE_SEC,
  MIN_NUDGE_SEC,
  clampNudge,
  planNudge,
  type Bounds,
  type NudgePlan,
} from "@/lib/practice/roundBounds";

/**
 * Ajuste a mano del tramo de la frase, dentro de la práctica.
 *
 * El afinado automático estira el corte hasta el primer silencio, pero cuando
 * el diálogo va encabalgado no hay silencio al que estirarse. Aquí se toca la
 * frase concreta, oyendo el resultado al momento, y se decide cuánto: la
 * cantidad de cada clic la pones tú.
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
  stepSec,
  onStepChange,
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
  /** Cuánto suma o resta cada clic. */
  stepSec: number;
  onStepChange: (sec: number) => void;
  onNudge: (side: "start" | "end", plan: NudgePlan) => void;
  onReset: () => void;
}) {
  /**
   * Lo escrito se guarda en crudo mientras se teclea: si se normalizara en
   * cada pulsación no se podría llegar a escribir "0,5" —el "0," se
   * convertiría en 0,25 antes del "5"—.
   */
  const [draft, setDraft] = React.useState(fmtSec(stepSec));
  React.useEffect(() => setDraft(fmtSec(stepSec)), [stepSec]);

  const commit = (raw: string) => {
    const v = clampNudge(Number(raw.replace(",", ".")));
    onStepChange(v);
    setDraft(fmtSec(v));
  };

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

  const amount = `${fmtSec(stepSec)} s`;
  const durationSec = Math.max(0, self.endSec - self.startSec);

  return (
    <div className="rounded-xl border-2 border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-soft">
          Tramo de la frase{" "}
          <span className="font-mono font-bold text-ink">
            {fmtClock(self.startSec)}–{fmtClock(self.endSec)}
          </span>{" "}
          · {fmtSec(durationSec)} s
        </p>
        {manual && (
          <Button variant="ghost" size="xs" onClick={onReset}>
            Automático
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-ink-soft">Cantidad</span>
          <TextInput
            type="number"
            inputMode="decimal"
            min={MIN_NUDGE_SEC}
            max={MAX_NUDGE_SEC}
            step={0.05}
            value={draft}
            aria-label="Segundos que suma o resta cada botón"
            className="h-8 w-20 text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(e.currentTarget.value);
            }}
          />
          <span className="text-xs font-bold text-ink-soft">s</span>
        </label>

        <Side
          label="Inicio"
          less={{
            label: "−",
            hint: `Empezar ${amount} después`,
            plan: plan("start", -stepSec),
          }}
          more={{
            label: "+",
            hint: `Empezar ${amount} antes`,
            plan: plan("start", stepSec),
          }}
          onNudge={(p) => onNudge("start", p)}
        />
        <Side
          label="Final"
          less={{
            label: "−",
            hint: `Terminar ${amount} antes`,
            plan: plan("end", -stepSec),
          }}
          more={{
            label: "+",
            hint: `Terminar ${amount} después`,
            plan: plan("end", stepSec),
          }}
          onNudge={(p) => onNudge("end", p)}
        />
      </div>
    </div>
  );
}

/** Sin decimales de más: 0,25 · 1 · 1,5 — y con coma, que es lo de aquí. */
function fmtSec(v: number): string {
  return String(Math.round(v * 100) / 100).replace(".", ",");
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
