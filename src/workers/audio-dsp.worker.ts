/// <reference lib="webworker" />
import * as Comlink from "comlink";

/**
 * Pool DSP. Fase 1: solo `computePeaks`. Fase 2 añade F0, energía y DTW
 * a este mismo worker sin cambiar el contrato de mensajes (plan D3).
 */

export interface Peaks {
  /** Pares [min, max] intercalados, `buckets` pares. */
  minmax: Float32Array;
  buckets: number;
  durationSec: number;
}

const api = {
  computePeaks(
    pcm: Float32Array,
    sampleRate: number,
    buckets = 800,
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
  },
};

export type AudioDspApi = typeof api;
Comlink.expose(api);
