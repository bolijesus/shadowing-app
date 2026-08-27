/** Envolvente de energía (§6.3): RMS por ventana de 20 ms, normalizada. */

export const ENERGY_WINDOW_SEC = 0.02;

export interface EnergyEnvelope {
  rms: Float32Array;
  hopSec: number;
}

export function computeEnergy(
  pcm: Float32Array,
  sampleRate: number,
  windowSec = ENERGY_WINDOW_SEC,
): EnergyEnvelope {
  const win = Math.max(1, Math.round(windowSec * sampleRate));
  const frames = Math.max(0, Math.floor(pcm.length / win));
  const rms = new Float32Array(frames);
  let peak = 0;

  for (let f = 0; f < frames; f++) {
    const off = f * win;
    let acc = 0;
    for (let i = 0; i < win; i++) {
      const v = pcm[off + i] ?? 0;
      acc += v * v;
    }
    const r = Math.sqrt(acc / win);
    rms[f] = r;
    if (r > peak) peak = r;
  }
  if (peak > 0) for (let i = 0; i < frames; i++) rms[i] = rms[i]! / peak;

  return { rms, hopSec: windowSec };
}

/**
 * Tramos de silencio > minSilenceSec sobre la envolvente normalizada.
 * Devuelve pares [inicioSec, finSec]. Base de la puntuación de pausas.
 */
export function detectPauses(
  env: EnergyEnvelope,
  minSilenceSec = 0.15,
  threshold = 0.08,
): [number, number][] {
  const out: [number, number][] = [];
  const minFrames = Math.max(1, Math.round(minSilenceSec / env.hopSec));
  let start = -1;

  for (let i = 0; i < env.rms.length; i++) {
    const silent = env.rms[i]! < threshold;
    if (silent && start === -1) start = i;
    if (!silent && start !== -1) {
      if (i - start >= minFrames) out.push([start * env.hopSec, i * env.hopSec]);
      start = -1;
    }
  }
  // Un silencio final no se cuenta como pausa interna.
  return out;
}
