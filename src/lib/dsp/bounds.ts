import type { EnergyEnvelope } from "./energy";

/**
 * Afinado de los cortes de una ronda contra el audio real.
 *
 * Los tiempos de un .srt marcan cuándo aparece y desaparece la línea en
 * pantalla, no cuándo empieza y acaba de sonar. Es habitual que el cue se
 * cierre encima de la última palabra: se oye "There's gotta be something wrong
 * with…" y el corte se come el "him". Aquí se busca en la envolvente de
 * energía el primer silencio sostenido a partir del final del cue y se lleva
 * el corte hasta ahí.
 *
 * Dos reglas que lo hacen seguro:
 *
 * - Solo ESTIRA, nunca acorta. En el peor caso se oye un poco de más, que es
 *   mejor que perder una palabra.
 * - Si no hay silencio dentro del tope —porque el siguiente hablante entra
 *   pisando—, se pone un margen pequeño en vez de tragarse la frase ajena.
 */

export interface RefinedBounds {
  startSec: number;
  endSec: number;
  /** Cuánto se ha estirado por cada lado, en segundos. */
  addedStartSec: number;
  addedEndSec: number;
  /** ¿Se encontró silencio donde acabar, o se puso el margen de reserva? */
  foundSilenceEnd: boolean;
}

export interface RefineOptions {
  /** Tope de estirado hacia atrás. */
  maxStartSec?: number;
  /** Tope de estirado hacia delante. */
  maxEndSec?: number;
  /** Silencio seguido que hace falta para dar la frase por terminada. */
  minSilenceSec?: number;
  /** Aire que se deja tras el último sonido, para no cortar en seco. */
  cushionSec?: number;
  /** Margen si no se encuentra silencio dentro del tope. */
  fallbackSec?: number;
  /** Margen fijo extra al final, a gusto del usuario. */
  extraEndSec?: number;
}

export const DEFAULT_REFINE: Required<Omit<RefineOptions, "extraEndSec">> = {
  maxStartSec: 0.4,
  maxEndSec: 0.7,
  minSilenceSec: 0.1,
  cushionSec: 0.06,
  fallbackSec: 0.18,
};

export function refineBounds(
  env: EnergyEnvelope,
  fromSec: number,
  toSec: number,
  durationSec: number,
  opts: RefineOptions = {},
): RefinedBounds | null {
  const {
    maxStartSec,
    maxEndSec,
    minSilenceSec,
    cushionSec,
    fallbackSec,
  } = { ...DEFAULT_REFINE, ...opts };
  const extraEndSec = opts.extraEndSec ?? 0;

  const hop = env.hopSec;
  const nf = env.rms.length;
  if (nf === 0 || toSec <= fromSec) return null;

  const fi = clampInt(Math.round(fromSec / hop), 0, nf);
  const ti = clampInt(Math.round(toSec / hop), 0, nf);
  const thr = speechThreshold(env, fi, ti);
  const runFrames = Math.max(1, Math.round(minSilenceSec / hop));

  // Final: primer silencio sostenido a partir del corte.
  let endSec = toSec + fallbackSec;
  let foundSilenceEnd = false;
  {
    const limit = Math.min(nf, ti + Math.ceil(maxEndSec / hop) + runFrames);
    let run = 0;
    let silStart = -1;
    for (let i = ti; i < limit; i++) {
      if (env.rms[i]! < thr) {
        if (run === 0) silStart = i;
        run++;
        if (run >= runFrames) {
          endSec = silStart * hop + cushionSec;
          foundSilenceEnd = true;
          break;
        }
      } else {
        run = 0;
      }
    }
  }
  endSec = Math.min(endSec + extraEndSec, toSec + maxEndSec, durationSec);
  endSec = Math.max(endSec, toSec);

  // Inicio: mismo criterio hacia atrás, por si el cue entra tarde.
  let startSec = fromSec - fallbackSec;
  {
    const limit = Math.max(0, fi - Math.ceil(maxStartSec / hop) - runFrames);
    let run = 0;
    let silEnd = -1;
    for (let i = fi - 1; i >= limit; i--) {
      if (env.rms[i]! < thr) {
        if (run === 0) silEnd = i + 1;
        run++;
        if (run >= runFrames) {
          startSec = silEnd * hop - cushionSec;
          break;
        }
      } else {
        run = 0;
      }
    }
  }
  startSec = Math.max(startSec, fromSec - maxStartSec, 0);
  startSec = Math.min(startSec, fromSec);

  return {
    startSec,
    endSec,
    addedStartSec: fromSec - startSec,
    addedEndSec: endSec - toSec,
    foundSilenceEnd,
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Percentil sobre una copia ordenada; `p` en 0–1. */
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  const i = clampInt(Math.round(p * (a.length - 1)), 0, a.length - 1);
  return a[i]!;
}

/**
 * Umbral voz/silencio adaptado al tramo.
 *
 * Un umbral fijo no vale: en una película el mismo 0,08 deja fuera una escena
 * susurrada y se traga el ruido de fondo de otra. Se estima el nivel de voz
 * dentro del cue y el suelo de ruido alrededor, y se corta entre los dos.
 */
export function speechThreshold(
  env: EnergyEnvelope,
  fi: number,
  ti: number,
): number {
  const nf = env.rms.length;
  const inside: number[] = [];
  for (let i = fi; i < ti && i < nf; i++) inside.push(env.rms[i]!);
  const margin = Math.round(1 / env.hopSec); // ~1 s a cada lado
  const around: number[] = [];
  for (let i = Math.max(0, fi - margin); i < Math.min(nf, ti + margin); i++) {
    around.push(env.rms[i]!);
  }
  const speech = percentile(inside, 0.75);
  const noise = percentile(around, 0.1);
  return Math.max(0.02, noise + 0.15 * Math.max(0, speech - noise));
}
