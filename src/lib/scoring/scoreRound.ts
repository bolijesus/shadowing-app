import { dtw, costToScore } from "@/lib/dsp/dtw";
import { prepareForDtw, resampleMean } from "@/lib/dsp/normalize";
import { dynamicRangeSemitones } from "@/lib/dsp/f0";
import type { Analysis } from "@/workers/audio-dsp.worker";

/**
 * Puntuación (§6.6). Cinco componentes 0–100.
 * Regla dura (§13.9): un componente que no se ha podido calcular NO se
 * inventa — se omite y el total se renormaliza sobre los presentes.
 */

export const ENGINE_VERSION = 2;

export type ComponentKey =
  | "words"
  | "intonation"
  | "timing"
  | "rhythmShape"
  | "durationMatch";

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  words: "Palabras",
  intonation: "Acento y entonación",
  timing: "Ritmo",
  rhythmShape: "Forma rítmica medida",
  durationMatch: "Duración medida",
};

export const DEFAULT_WEIGHTS: Record<ComponentKey, number> = {
  words: 0.3,
  intonation: 0.25,
  timing: 0.2,
  rhythmShape: 0.15,
  durationMatch: 0.1,
};

export interface RoundScore {
  total: number;
  components: Partial<Record<ComponentKey, number>>;
  present: ComponentKey[];
  weights: Record<ComponentKey, number>;
  engineVersion: number;
  /** Datos derivados que usa el consejo. */
  detail: {
    durTakeSec: number;
    durModelSec: number;
    rangeModelSt: number;
    rangeTakeSt: number;
    pausesModel: number;
    pausesTake: number;
  };
  asrText?: string;
  tip?: string;
}

/** 100·exp(−3·|ln(durTake/durModelo)|) */
export function durationMatchScore(durTake: number, durModel: number): number {
  if (durTake <= 0 || durModel <= 0) return 0;
  return Math.round(
    Math.max(0, Math.min(100, 100 * Math.exp(-3 * Math.abs(Math.log(durTake / durModel))))),
  );
}

/** Alineación de pausas: qué fracción de las del modelo aparecen cerca en la toma. */
function pauseAlignmentScore(
  model: [number, number][],
  take: [number, number][],
  durModel: number,
  durTake: number,
): number {
  if (model.length === 0 && take.length === 0) return 100;
  const scale = durModel > 0 ? durTake / durModel : 1;
  const tol = 0.35; // segundos de tolerancia sobre el eje del modelo

  let hits = 0;
  for (const [ms] of model) {
    const expected = ms * scale;
    if (take.some(([ts]) => Math.abs(ts - expected) <= tol * Math.max(1, scale)))
      hits++;
  }
  const recall = model.length ? hits / model.length : 1;
  // Penaliza pausas de más (cortar dentro del grupo de sentido).
  const extra = Math.max(0, take.length - model.length);
  const penalty = Math.min(1, extra * 0.2);
  return Math.round(Math.max(0, Math.min(100, 100 * (recall * (1 - penalty)))));
}

export interface ScoreArgs {
  model: Analysis | null;
  take: Analysis;
  weights?: Partial<Record<ComponentKey, number>>;
  /** Presentes solo cuando hay ASR (fase de IA). */
  asrText?: string;
  referenceText?: string;
}

export function scoreRound(args: ScoreArgs): RoundScore {
  const { model, take } = args;
  const components: Partial<Record<ComponentKey, number>> = {};

  const durTake = take.durationSec;
  const durModel = model?.durationSec ?? 0;
  const rangeTakeSt = dynamicRangeSemitones(take.semitones);
  const rangeModelSt = model ? dynamicRangeSemitones(model.semitones) : 0;

  if (model) {
    components.durationMatch = durationMatchScore(durTake, durModel);

    // Ritmo: DTW sobre envolventes de energía.
    const rhythm = dtw(
      prepareForDtw(model.energy),
      prepareForDtw(take.energy),
    );
    components.rhythmShape = costToScore(rhythm.cost, 0.9);

    // Entonación: DTW sobre contornos en semitonos + castigo a la lectura plana.
    const into = dtw(
      prepareForDtw(model.semitones),
      prepareForDtw(take.semitones),
    );
    let intonation = costToScore(into.cost, 0.8);
    if (rangeModelSt > 0.5) {
      // Si el modelo tiene relieve y la toma no, la nota baja de verdad.
      const ratio = Math.min(1, rangeTakeSt / rangeModelSt);
      intonation = Math.round(intonation * (0.45 + 0.55 * ratio));
    }
    if (into.coverage < 0.25) {
      // Casi no hay voz que comparar: no es una nota fiable.
      delete components.rhythmShape;
    } else {
      components.intonation = intonation;
    }

    const pauseScore = pauseAlignmentScore(
      model.pauses,
      take.pauses,
      durModel,
      durTake,
    );
    components.timing = Math.round(
      (components.durationMatch + pauseScore) / 2,
    );
  }

  // `words` solo existe cuando hay ASR de verdad (fase de IA).
  if (args.asrText !== undefined && args.referenceText) {
    components.words = wordsScore(args.asrText, args.referenceText);
  }

  const weights = { ...DEFAULT_WEIGHTS, ...args.weights };
  const present = (Object.keys(components) as ComponentKey[]).filter(
    (k) => typeof components[k] === "number",
  );

  // Renormalización sobre los componentes presentes (§13.9).
  const weightSum = present.reduce((s, k) => s + weights[k], 0);
  const total =
    weightSum > 0
      ? Math.round(
          present.reduce((s, k) => s + weights[k] * components[k]!, 0) /
            weightSum,
        )
      : 0;

  const detail = {
    durTakeSec: durTake,
    durModelSec: durModel,
    rangeModelSt,
    rangeTakeSt,
    pausesModel: model?.pauses.length ?? 0,
    pausesTake: take.pauses.length,
  };

  return {
    total,
    components,
    present,
    weights,
    engineVersion: ENGINE_VERSION,
    detail,
    asrText: args.asrText,
  };
}

/* --------- WER (se activa con ASR en la fase de IA) --------- */

export function normalizeForWer(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function wordErrorRate(hyp: string, ref: string): number {
  const h = normalizeForWer(hyp);
  const r = normalizeForWer(ref);
  if (r.length === 0) return h.length === 0 ? 0 : 1;

  const prev = new Array<number>(h.length + 1);
  const cur = new Array<number>(h.length + 1);
  for (let j = 0; j <= h.length; j++) prev[j] = j;

  for (let i = 1; i <= r.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= h.length; j++) prev[j] = cur[j]!;
  }
  return prev[h.length]! / r.length;
}

export function wordsScore(hyp: string, ref: string): number {
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - wordErrorRate(hyp, ref)))));
}

/**
 * Curva lista para pintar: semitonos remuestreados al ancho de la onda.
 *
 * Ojo con la diferencia: para PUNTUAR se usan `semitones` con sus huecos
 * (§6.2 prohíbe interpolar a través de las pausas, porque falsearía el DTW).
 * Esto es solo para DIBUJAR, y ahí sí se quiere un trazo continuo de borde
 * a borde: se rellenan los huecos y se mantiene plano en los extremos.
 */
export function contourForDisplay(
  semitones: Float32Array,
  points = 220,
): Float32Array {
  // Media por bin: reducir con interpolación lineal propagaba los NaN y
  // ensanchaba cada hueco, que es lo que rompía la línea en trocitos.
  const r = resampleMean(semitones, points);

  const out = new Float32Array(r.length);
  // Escala a [-1, 1] con ±8 semitonos como fondo de escala.
  for (let i = 0; i < r.length; i++) {
    const v = r[i]!;
    out[i] = Number.isNaN(v) ? NaN : Math.max(-1, Math.min(1, v / 8));
  }

  const firstVoiced = out.findIndex((v) => !Number.isNaN(v));
  if (firstVoiced === -1) return out.fill(0);

  let lastVoiced = out.length - 1;
  while (lastVoiced > 0 && Number.isNaN(out[lastVoiced]!)) lastVoiced--;

  // Extremos planos, como en el diseño de referencia.
  out.fill(out[firstVoiced]!, 0, firstVoiced);
  out.fill(out[lastVoiced]!, lastVoiced + 1);

  // Huecos interiores: se cosen linealmente entre los extremos con voz.
  let gap = -1;
  for (let i = firstVoiced; i <= lastVoiced; i++) {
    if (Number.isNaN(out[i]!)) {
      if (gap === -1) gap = i;
      continue;
    }
    if (gap > 0) {
      const len = i - gap;
      const a = out[gap - 1]!;
      const b = out[i]!;
      for (let k = 0; k < len; k++) {
        out[gap + k] = a + ((b - a) * (k + 1)) / (len + 1);
      }
    }
    gap = -1;
  }
  return out;
}
