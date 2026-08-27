/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { computeF0 } from "@/lib/dsp/f0";
import { computeEnergy, detectPauses } from "@/lib/dsp/energy";

/**
 * Pool DSP: picos de onda, F0 y envolvente de energía.
 * Todo el análisis pesado vive aquí; el hilo de UI nunca se bloquea.
 */

export interface Peaks {
  /** Pares [min, max] intercalados, `buckets` pares. */
  minmax: Float32Array;
  buckets: number;
  durationSec: number;
}

export interface Analysis {
  peaks: Peaks;
  /** F0 en semitonos relativos a la mediana del hablante; NaN = sordo. */
  semitones: Float32Array;
  /** F0 en Hz; NaN = sordo. */
  hz: Float32Array;
  medianHz: number;
  f0HopSec: number;
  /** Envolvente RMS normalizada. */
  energy: Float32Array;
  energyHopSec: number;
  /** Pausas [inicioSec, finSec] > 150 ms. */
  pauses: [number, number][];
  durationSec: number;
  sampleRate: number;
}

function peaksFrom(
  pcm: Float32Array,
  sampleRate: number,
  buckets: number,
): Peaks {
  const n = pcm.length;
  const out = new Float32Array(buckets * 2);
  const per = Math.max(1, Math.floor(n / buckets));
  for (let b = 0; b < buckets; b++) {
    const start = b * per;
    const end = b === buckets - 1 ? n : Math.min(n, start + per);
    let mn = 1;
    let mx = -1;
    for (let i = start; i < end; i++) {
      const v = pcm[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (start >= end) {
      mn = 0;
      mx = 0;
    }
    out[b * 2] = mn;
    out[b * 2 + 1] = mx;
  }
  return { minmax: out, buckets, durationSec: n / sampleRate };
}

const api = {
  computePeaks(pcm: Float32Array, sampleRate: number, buckets = 800): Peaks {
    return peaksFrom(pcm, sampleRate, buckets);
  },

  /**
   * Análisis completo de un rango ya decodificado: picos + F0 + energía.
   * Una sola pasada sobre el mismo buffer, sin copias intermedias.
   */
  analyze(
    pcm: Float32Array,
    sampleRate: number,
    buckets = 800,
  ): Analysis {
    const peaks = peaksFrom(pcm, sampleRate, buckets);
    const f0 = computeF0(pcm, sampleRate);
    const env = computeEnergy(pcm, sampleRate);
    const pauses = detectPauses(env);

    return {
      peaks,
      semitones: f0.semitones,
      hz: f0.hz,
      medianHz: f0.medianHz,
      f0HopSec: f0.hopSec,
      energy: env.rms,
      energyHopSec: env.hopSec,
      pauses,
      durationSec: pcm.length / sampleRate,
      sampleRate,
    };
  },
};

export type AudioDspApi = typeof api;
Comlink.expose(api);
