/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { computeF0 } from "@/lib/dsp/f0";
import { computeEnergy, detectPauses } from "@/lib/dsp/energy";

/**
 * PCM decodificado del recorte en curso.
 *
 * Antes cada análisis volvía a leer y decodificar el archivo ENTERO, y encima
 * en el hilo principal: con un capítulo de 22 minutos y cinco rondas eran seis
 * decodificaciones completas y el navegador se quedaba colgado. Ahora se
 * decodifica una vez aquí, se guarda el trozo del recorte —que son unos pocos
 * MB— y cada ronda sale de ese buffer.
 */
let cached: { token: string; pcm: Float32Array; sampleRate: number } | null =
  null;

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
   * Recibe el PCM ya decodificado y lo guarda para todas las rondas.
   *
   * La decodificación NO puede hacerse aquí: Web Audio (AudioContext y
   * OfflineAudioContext) solo está expuesto en Window, no en workers. Se
   * decodifica una vez en el hilo principal y lo que llega aquí son las
   * muestras del recorte —unos pocos MB— como transferible, sin copia.
   */
  loadPcm(
    pcm: Float32Array,
    sampleRate: number,
    token: string,
  ): { durationSec: number; sampleRate: number } {
    cached = { token, pcm, sampleRate };
    return { durationSec: pcm.length / sampleRate, sampleRate };
  },

  /** ¿Está ya decodificado este recorte? */
  hasRange(token: string): boolean {
    return cached?.token === token;
  },

  /** Picos de todo el rango cargado. */
  peaksOf(token: string, buckets = 800): Peaks | null {
    if (cached?.token !== token) return null;
    return peaksFrom(cached.pcm, cached.sampleRate, buckets);
  },

  /**
   * Analiza un sub-rango del recorte ya cargado, en segundos relativos al
   * inicio del recorte. Es lo que usa cada ronda: sin volver a decodificar.
   */
  analyzeSub(
    token: string,
    fromSec: number,
    toSec: number,
    buckets = 800,
  ): Analysis | null {
    if (cached?.token !== token) return null;
    const sr = cached.sampleRate;
    const a = Math.max(0, Math.floor(fromSec * sr));
    const b = Math.min(cached.pcm.length, Math.ceil(toSec * sr));
    if (b <= a) return null;
    return api.analyze(cached.pcm.subarray(a, b), sr, buckets);
  },

  /** El recorte ya decodificado, como WAV mono de 16 bits. */
  wavOf(token: string): ArrayBuffer | null {
    if (cached?.token !== token) return null;
    const { pcm, sampleRate } = cached;
    const out = new ArrayBuffer(44 + pcm.length * 2);
    const dv = new DataView(out);
    const ascii = (o: number, t: string) => {
      for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i));
    };
    ascii(0, "RIFF");
    dv.setUint32(4, 36 + pcm.length * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, "data");
    dv.setUint32(40, pcm.length * 2, true);
    let off = 44;
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]!));
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
    return out;
  },

  releaseRange(): void {
    cached = null;
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
