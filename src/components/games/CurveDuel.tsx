"use client";

import * as React from "react";
import { Button, Eyebrow, Pill } from "@/components/ui/primitives";
import { ContourCompare } from "@/components/waveform/ContourCompare";
import { BigScore } from "@/components/practice/ScoreBreakdown";
import { contourForDisplay, scoreRound } from "@/lib/scoring/scoreRound";
import { buildAdvice } from "@/lib/scoring/advice";
import type { Analysis } from "@/lib/audio/analysis";

export type DuelPhase = "study" | "recording" | "result";

/**
 * Duelo de curvas (§7.E).
 *
 * Ves la curva del modelo SIN oírla y tratas de reproducir el contorno. La
 * nota es solo `intonation`: pesar aquí la duración o el ritmo mediría algo
 * que el ejercicio no pide. Al terminar, tu curva se superpone a la suya,
 * que es lo que deja ver dónde te separas.
 */
export function CurveDuel({
  modelAnalysis,
  takeAnalysis,
  phase,
  scoring,
  onRecord,
  onStop,
  onRetry,
  onNext,
  onRevealAudio,
  recPct,
  isLast,
}: {
  modelAnalysis: Analysis | null;
  takeAnalysis: Analysis | null;
  phase: DuelPhase;
  scoring: boolean;
  onRecord: () => void;
  onStop: () => void;
  onRetry: () => void;
  onNext: () => void;
  /** Escuchar el modelo: se ofrece solo después de intentarlo. */
  onRevealAudio: () => void;
  recPct: number;
  isLast: boolean;
}) {
  const modelContour = React.useMemo(
    () => (modelAnalysis ? contourForDisplay(modelAnalysis.semitones) : null),
    [modelAnalysis],
  );
  const takeContour = React.useMemo(
    () =>
      takeAnalysis && phase === "result"
        ? contourForDisplay(takeAnalysis.semitones)
        : null,
    [takeAnalysis, phase],
  );

  const score = React.useMemo(() => {
    if (!modelAnalysis || !takeAnalysis || phase !== "result") return null;
    const s = scoreRound({
      model: modelAnalysis,
      take: takeAnalysis,
      only: ["intonation"],
    });
    return { ...s, tip: buildAdvice(s) };
  }, [modelAnalysis, takeAnalysis, phase]);

  if (!modelAnalysis) {
    return (
      <div className="rounded-xl border-2 border-line bg-surface p-5">
        <Eyebrow>Duelo de curvas</Eyebrow>
        <p className="mt-2 text-sm text-ink-soft">
          Este modo necesita la curva de entonación del modelo, y para eso hace
          falta el audio original. En una práctica de YouTube no la hay: el
          navegador no da acceso al sonido del reproductor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border-2 border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Duelo de curvas</Eyebrow>
        {phase === "study" && <Pill>Sin audio: guíate por la forma</Pill>}
      </div>

      <ContourCompare
        model={modelContour}
        take={takeContour}
        height={170}
        labels={{ model: "Modelo", take: "Tú" }}
      />

      {phase === "study" && (
        <>
          <p className="text-sm text-ink-soft">
            Mira la curva y di la frase intentando seguir esa forma: dónde sube,
            dónde baja y cuánto. No la escuches todavía.
          </p>
          <Button className="h-16 w-full text-lg" variant="record" onClick={onRecord}>
            ● Grabar mi intento
          </Button>
        </>
      )}

      {phase === "recording" && (
        <Button
          className="h-16 w-full text-lg"
          variant="record"
          onClick={onStop}
        >
          ■ Detener ({Math.round(recPct * 100)}%)
        </Button>
      )}

      {phase === "result" && (
        <>
          {scoring && (
            <p className="text-sm font-semibold text-ink-soft">
              Comparando las curvas…
            </p>
          )}

          {!scoring && score && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <BigScore value={score.total} />
                <span className="text-sm text-ink-soft">
                  Solo entonación. Ni la duración ni el ritmo cuentan en este
                  modo.
                </span>
              </div>
              {score.tip && (
                <p className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-[15px] text-ink">
                  {score.tip}
                </p>
              )}
            </div>
          )}

          {!scoring && !score && (
            <p className="text-sm text-ink-soft">
              No se pudo comparar tu curva con la del modelo. Prueba a grabar de
              nuevo hablando un poco más alto.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onRevealAudio}>
              Escuchar el modelo
            </Button>
            <Button variant="outline" onClick={onRetry}>
              Intentar otra vez
            </Button>
          </div>
          <Button className="h-14 w-full" onClick={onNext}>
            {isLast ? "Guardar y ver resumen" : "Guardar y continuar"}
          </Button>
        </>
      )}
    </div>
  );
}
