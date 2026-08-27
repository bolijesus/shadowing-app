import { PitchDetector } from "pitchy";

/**
 * Curva de entonación (§6.2).
 * Ventana 40 ms, salto 10 ms, MPM/YIN vía `pitchy`.
 * Puerta de voz: RMS bajo o claridad < 0.6 → NaN (no se interpola).
 * Suavizado: mediana de 5 + media móvil de 3.
 * Normalización a semitonos relativos a la mediana del hablante.
 */

export const F0_WINDOW_SEC = 0.04;
export const F0_HOP_SEC = 0.01;
const CLARITY_MIN = 0.6;
const F0_MIN_HZ = 60;
const F0_MAX_HZ = 500;

export interface F0Curve {
  /** Hz por trama; NaN en tramos sordos o silencio. */
  hz: Float32Array;
  /** Semitonos relativos a la mediana del hablante; NaN donde hz es NaN. */
  semitones: Float32Array;
  hopSec: number;
  /** Mediana de F0 del hablante (Hz). NaN si no hubo voz. */
  medianHz: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mediana móvil de 5 que respeta los NaN (no rellena huecos). */
function medianFilter5(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(src[i]!)) {
      out[i] = NaN;
      continue;
    }
    const win: number[] = [];
    for (let k = -2; k <= 2; k++) {
      const v = src[i + k];
      if (v !== undefined && !Number.isNaN(v)) win.push(v);
    }
    out[i] = win.length ? median(win) : NaN;
  }
  return out;
}

/** Media móvil de 3 que respeta los NaN. */
function movingAvg3(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(src[i]!)) {
      out[i] = NaN;
      continue;
    }
    let sum = 0;
    let n = 0;
    for (let k = -1; k <= 1; k++) {
      const v = src[i + k];
      if (v !== undefined && !Number.isNaN(v)) {
        sum += v;
        n++;
      }
    }
    out[i] = n ? sum / n : NaN;
  }
  return out;
}

export function computeF0(pcm: Float32Array, sampleRate: number): F0Curve {
  const win = Math.max(256, nextPow2(Math.round(F0_WINDOW_SEC * sampleRate)));
  const hop = Math.max(1, Math.round(F0_HOP_SEC * sampleRate));
  const frames = pcm.length >= win ? Math.floor((pcm.length - win) / hop) + 1 : 0;

  const hz = new Float32Array(Math.max(0, frames));
  if (frames === 0) {
    return { hz, semitones: new Float32Array(0), hopSec: F0_HOP_SEC, medianHz: NaN };
  }

  // Umbral de energía relativo al pico, para no analizar silencio.
  const rms = new Float32Array(frames);
  let peakRms = 0;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let acc = 0;
    for (let i = 0; i < win; i++) {
      const v = pcm[off + i] ?? 0;
      acc += v * v;
    }
    const r = Math.sqrt(acc / win);
    rms[f] = r;
    if (r > peakRms) peakRms = r;
  }
  const rmsGate = peakRms * 0.06;

  const detector = PitchDetector.forFloat32Array(win);
  const buf = new Float32Array(win);

  for (let f = 0; f < frames; f++) {
    if (rms[f]! < rmsGate) {
      hz[f] = NaN;
      continue;
    }
    buf.set(pcm.subarray(f * hop, f * hop + win));
    const [pitch, clarity] = detector.findPitch(buf, sampleRate);
    hz[f] =
      clarity >= CLARITY_MIN && pitch >= F0_MIN_HZ && pitch <= F0_MAX_HZ
        ? pitch
        : NaN;
  }

  const smooth = movingAvg3(medianFilter5(hz));

  const voiced: number[] = [];
  for (const v of smooth) if (!Number.isNaN(v)) voiced.push(v);
  const medianHz = median(voiced);

  const semitones = new Float32Array(smooth.length);
  for (let i = 0; i < smooth.length; i++) {
    const v = smooth[i]!;
    semitones[i] =
      Number.isNaN(v) || !isFinite(medianHz) || medianHz <= 0
        ? NaN
        : 12 * Math.log2(v / medianHz);
  }

  return { hz: smooth, semitones, hopSec: F0_HOP_SEC, medianHz };
}

/** Rango dinámico en semitonos (p95 − p05). Una lectura plana da ~0. */
export function dynamicRangeSemitones(semitones: Float32Array): number {
  const v: number[] = [];
  for (const x of semitones) if (!Number.isNaN(x)) v.push(x);
  if (v.length < 4) return 0;
  v.sort((a, b) => a - b);
  const p = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))]!;
  return p(0.95) - p(0.05);
}
