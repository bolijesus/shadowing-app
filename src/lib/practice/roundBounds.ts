import type { Round } from "@/lib/types";

/**
 * Tramo de audio de una ronda: lo automático y lo que ajustas a mano.
 *
 * Los cortes salen de los tiempos del subtítulo, que marcan cuándo entra y
 * sale la línea en pantalla y no cuándo empieza y acaba de sonar. El afinado
 * automático (`lib/dsp/bounds.ts`) los estira hasta el primer silencio, pero
 * cuando el diálogo va encabalgado no hay silencio al que estirarse. Aquí
 * viven las reglas del ajuste manual, que manda sobre lo automático.
 */

export interface Bounds {
  startSec: number;
  endSec: number;
}

/** Cuánto mueve cada clic. */
export const NUDGE_STEP_SEC = 0.25;

/**
 * Mínimo que se le deja a la ronda vecina al empujar su frontera.
 *
 * No se reutiliza `MIN_ROUND_SEC` (1,2 s) de `subtitles/segmentation.ts`:
 * aquel es el umbral para fusionar cues al segmentar. Aplicarlo aquí
 * impediría mover la frontera en diálogos rápidos que son legítimamente
 * cortos.
 */
export const MIN_ADJUSTED_SEC = 0.6;

/** El manual si lo hay; si no, el automático; si no, el del subtítulo. */
export function effectiveBounds(round: Round, auto: Bounds | null): Bounds {
  return {
    startSec: round.manualStartSec ?? auto?.startSec ?? round.startSec,
    endSec: round.manualEndSec ?? auto?.endSec ?? round.endSec,
  };
}

/** ¿Tiene esta ronda algún lado fijado a mano? */
export function hasManualBounds(round: Round): boolean {
  return round.manualStartSec !== undefined || round.manualEndSec !== undefined;
}

export interface NudgeArgs {
  side: "start" | "end";
  /** Positivo = más audio por ese lado; negativo = recorta. */
  deltaSec: number;
  /** Tramo efectivo actual de la ronda que se toca. */
  self: Bounds;
  /** Tramo efectivo de la vecina de ese lado, si la hay. */
  neighbour: Bounds | null;
  /** Fuera del recorte no hay PCM decodificado: ni onda ni análisis. */
  clip: Bounds;
}

/**
 * Lo que hay que escribir en cada ronda. Un campo presente y a `undefined`
 * borra la propiedad en Dexie, que es como se vuelve al afinado automático.
 */
export interface BoundsPatch {
  manualStartSec?: number | undefined;
  manualEndSec?: number | undefined;
}

/** Deshace el ajuste manual de los dos lados. */
export const CLEAR_BOUNDS: BoundsPatch = {
  manualStartSec: undefined,
  manualEndSec: undefined,
};

export interface NudgePlan {
  self: BoundsPatch;
  neighbour: BoundsPatch | null;
}

/**
 * Qué escribir al empujar un lado de la ronda.
 *
 * Mover un lado mueve la FRONTERA con la vecina: si alargas el final de la
 * primera frase, la segunda arranca donde acaba la primera. Así cada frase
 * sigue sonando sobre su propia voz y nada se oye dos veces.
 *
 * Devuelve `null` cuando el tope no deja mover nada —el borde del recorte, o
 * dejaría a la vecina por debajo del mínimo—, para poder deshabilitar el
 * botón en vez de fingir que hizo algo.
 */
export function planNudge(args: NudgeArgs): NudgePlan | null {
  const { side, deltaSec, self, neighbour, clip } = args;
  if (deltaSec === 0) return null;

  if (side === "end") {
    // `+` alarga hacia delante, así que el final sube.
    let end = self.endSec + deltaSec;
    end = Math.min(end, clip.endSec);
    // La ronda no puede quedarse sin nada por su propio lado.
    end = Math.max(end, self.startSec + MIN_ADJUSTED_SEC);
    // Ni comerse a la vecina entera.
    if (neighbour) end = Math.min(end, neighbour.endSec - MIN_ADJUSTED_SEC);
    if (!moved(end, self.endSec)) return null;
    return {
      self: { manualEndSec: end },
      neighbour: neighbour ? { manualStartSec: end } : null,
    };
  }

  // `+` alarga hacia atrás, así que el inicio baja.
  let start = self.startSec - deltaSec;
  start = Math.max(start, clip.startSec);
  start = Math.min(start, self.endSec - MIN_ADJUSTED_SEC);
  if (neighbour) start = Math.max(start, neighbour.startSec + MIN_ADJUSTED_SEC);
  if (!moved(start, self.startSec)) return null;
  return {
    self: { manualStartSec: start },
    neighbour: neighbour ? { manualEndSec: start } : null,
  };
}

/** Un movimiento por debajo de un milisegundo no es un movimiento. */
function moved(next: number, prev: number): boolean {
  return Math.abs(next - prev) > 0.001;
}
