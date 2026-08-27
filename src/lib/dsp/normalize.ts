/**
 * Remuestreo y z-normalización de series, tolerantes a NaN (tramos sordos).
 * Es lo que permite comparar dos series de distinta longitud con DTW.
 */

export const DTW_POINTS = 100;

/** Remuestreo lineal a `n` puntos. Un NaN vecino propaga NaN (no inventa voz). */
export function resampleTo(src: Float32Array, n = DTW_POINTS): Float32Array {
  const out = new Float32Array(n);
  if (src.length === 0) {
    out.fill(NaN);
    return out;
  }
  if (src.length === 1) {
    out.fill(src[0]!);
    return out;
  }
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (src.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(src.length - 1, lo + 1);
    const t = pos - lo;
    const a = src[lo]!;
    const b = src[hi]!;
    out[i] =
      Number.isNaN(a) || Number.isNaN(b) ? NaN : a * (1 - t) + b * t;
  }
  return out;
}

/** z-normaliza ignorando NaN; los NaN se conservan. */
export function zNormalize(src: Float32Array): Float32Array {
  const vals: number[] = [];
  for (const v of src) if (!Number.isNaN(v)) vals.push(v);
  const out = new Float32Array(src.length);
  if (vals.length < 2) {
    out.fill(NaN);
    return out;
  }
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const varr =
    vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
  const sd = Math.sqrt(varr);
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    out[i] = Number.isNaN(v) ? NaN : sd > 1e-9 ? (v - mean) / sd : 0;
  }
  return out;
}

/** Preparación estándar para DTW: remuestrear a 100 puntos y z-normalizar. */
export function prepareForDtw(src: Float32Array, n = DTW_POINTS): Float32Array {
  return zNormalize(resampleTo(src, n));
}

/** Proporción de tramas con voz (no NaN). */
export function voicedRatio(src: Float32Array): number {
  if (!src.length) return 0;
  let n = 0;
  for (const v of src) if (!Number.isNaN(v)) n++;
  return n / src.length;
}
