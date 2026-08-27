/**
 * Dynamic Time Warping sobre series ya z-normalizadas y remuestreadas.
 * Devuelve el coste medio por paso del camino óptimo, que es lo que
 * después se convierte en nota con 100·exp(−k·coste).
 */

export interface DtwResult {
  /** Coste medio por paso del camino óptimo. Infinity si no comparable. */
  cost: number;
  /** Fracción de pares comparables (ambas series con valor). */
  coverage: number;
}

const BAND = 0.25; // banda de Sakoe-Chiba, como fracción de la longitud

export function dtw(a: Float32Array, b: Float32Array): DtwResult {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return { cost: Infinity, coverage: 0 };

  const band = Math.max(2, Math.floor(Math.max(n, m) * BAND));
  const INF = Number.POSITIVE_INFINITY;

  // Coste acumulado y número de pasos, para normalizar por longitud del camino.
  const D = new Float64Array((n + 1) * (m + 1)).fill(INF);
  const L = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  D[at(0, 0)] = 0;

  let comparable = 0;
  let pairs = 0;

  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - band);
    const hi = Math.min(m, i + band);
    for (let j = lo; j <= hi; j++) {
      const av = a[i - 1]!;
      const bv = b[j - 1]!;
      let d: number;
      if (Number.isNaN(av) || Number.isNaN(bv)) {
        // Tramo sordo en alguno de los dos: no penaliza ni premia.
        d = 0;
      } else {
        d = Math.abs(av - bv);
      }

      const prev = [D[at(i - 1, j - 1)]!, D[at(i - 1, j)]!, D[at(i, j - 1)]!];
      let best = 0;
      let bestVal = prev[0]!;
      for (let k = 1; k < 3; k++) {
        if (prev[k]! < bestVal) {
          bestVal = prev[k]!;
          best = k;
        }
      }
      if (bestVal === INF) continue;

      const from =
        best === 0 ? at(i - 1, j - 1) : best === 1 ? at(i - 1, j) : at(i, j - 1);
      D[at(i, j)] = bestVal + d;
      L[at(i, j)] = L[from]! + 1;
    }
  }

  for (let i = 0; i < Math.min(n, m); i++) {
    pairs++;
    if (!Number.isNaN(a[i]!) && !Number.isNaN(b[i]!)) comparable++;
  }

  const total = D[at(n, m)]!;
  const steps = L[at(n, m)]! || 1;
  return {
    cost: isFinite(total) ? total / steps : Infinity,
    coverage: pairs ? comparable / pairs : 0,
  };
}

/** Convierte un coste DTW en nota 0–100. */
export function costToScore(cost: number, k: number): number {
  if (!isFinite(cost)) return 0;
  return Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-k * cost))));
}
