import type { Cue } from "@/lib/types";

export interface RoundSeed {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

const MIN_ROUND_SEC = 1.2;
const MAX_ROUND_SEC = 12;

export interface SegmentOptions {
  /** Cuántas frases entran en cada ronda. 1 = una ronda por cue. */
  phrasesPerRound?: number;
}

/**
 * Segmentación con subtítulos (prompt §9): una ronda por cue,
 * fusiona cues < 1,2 s con el siguiente, divide cues > 12 s por puntuación.
 * Después, si se pide, agrupa las frases resultantes de N en N.
 */
export function segmentFromCues(
  cues: Cue[],
  rangeStart = 0,
  rangeEnd = Infinity,
  opts: SegmentOptions = {},
): RoundSeed[] {
  const inRange = cues
    .filter((c) => c.end > rangeStart && c.start < rangeEnd)
    .map((c) => ({
      start: Math.max(c.start, rangeStart),
      end: Math.min(c.end, rangeEnd === Infinity ? c.end : rangeEnd),
      text: c.text.trim(),
    }))
    .filter((c) => c.end > c.start && c.text);

  // Fusión de cues demasiado cortos.
  const merged: { start: number; end: number; text: string }[] = [];
  for (const c of inRange) {
    const last = merged[merged.length - 1];
    if (last && c.end - last.start < MIN_ROUND_SEC) {
      last.end = c.end;
      last.text = `${last.text} ${c.text}`.trim();
    } else if (last && c.end - c.start < MIN_ROUND_SEC && c.start - last.end < 0.4) {
      last.end = c.end;
      last.text = `${last.text} ${c.text}`.trim();
    } else {
      merged.push({ ...c });
    }
  }

  // División de cues demasiado largos por puntuación fuerte.
  const out: RoundSeed[] = [];
  for (const c of merged) {
    if (c.end - c.start <= MAX_ROUND_SEC) {
      out.push({ index: out.length, startSec: c.start, endSec: c.end, text: c.text });
      continue;
    }
    const pieces = c.text.split(/(?<=[.!?…。！？])\s+/).filter(Boolean);
    if (pieces.length < 2) {
      out.push({ index: out.length, startSec: c.start, endSec: c.end, text: c.text });
      continue;
    }
    const totalChars = pieces.reduce((s, p) => s + p.length, 0);
    let t = c.start;
    for (const piece of pieces) {
      const dur = ((c.end - c.start) * piece.length) / totalChars;
      out.push({
        index: out.length,
        startSec: t,
        endSec: Math.min(c.end, t + dur),
        text: piece.trim(),
      });
      t += dur;
    }
  }
  return groupSeeds(out, opts.phrasesPerRound ?? 1);
}

/** Tope duro: una ronda más larga que esto ya no se puede imitar de una vez. */
export const MAX_GROUPED_SEC = 30;

/**
 * Junta las frases ya normalizadas de N en N (§9). El texto se une con un
 * espacio y el rango va del inicio de la primera al final de la última.
 * Se corta antes si el grupo se pasa de `MAX_GROUPED_SEC`, para que pedir
 * "4 frases" sobre subtítulos muy largos no produzca una ronda inabordable.
 */
export function groupSeeds(seeds: RoundSeed[], perRound: number): RoundSeed[] {
  const n = Math.max(1, Math.floor(perRound));
  if (n === 1 || seeds.length <= 1) return seeds;

  const out: RoundSeed[] = [];
  let buf: RoundSeed[] = [];

  const flush = () => {
    if (!buf.length) return;
    out.push({
      index: out.length,
      startSec: buf[0]!.startSec,
      endSec: buf[buf.length - 1]!.endSec,
      text: buf.map((s) => s.text).join(" ").trim(),
    });
    buf = [];
  };

  for (const seed of seeds) {
    const wouldSpan = buf.length
      ? seed.endSec - buf[0]!.startSec
      : seed.endSec - seed.startSec;
    if (buf.length && wouldSpan > MAX_GROUPED_SEC) flush();
    buf.push(seed);
    if (buf.length >= n) flush();
  }
  flush();
  return out;
}

/**
 * Segmentación sin subtítulos: cortes en silencios de la envolvente RMS
 * (umbral relativo, silencio mínimo 300 ms). `rms` es una serie regular.
 */
export function segmentFromEnvelope(
  rms: Float32Array,
  hopSec: number,
  rangeStart = 0,
): RoundSeed[] {
  if (rms.length === 0) return [];
  let max = 0;
  for (const v of rms) if (v > max) max = v;
  const thr = max * 0.12;
  const minSilenceFrames = Math.max(1, Math.round(0.3 / hopSec));
  const minRoundFrames = Math.max(1, Math.round(MIN_ROUND_SEC / hopSec));

  const segments: [number, number][] = [];
  let segStart = -1;
  let silence = 0;
  for (let i = 0; i < rms.length; i++) {
    const voiced = rms[i]! > thr;
    if (voiced) {
      if (segStart === -1) segStart = i;
      silence = 0;
    } else if (segStart !== -1) {
      silence++;
      if (silence >= minSilenceFrames) {
        const end = i - silence + 1;
        if (end - segStart >= minRoundFrames) segments.push([segStart, end]);
        segStart = -1;
        silence = 0;
      }
    }
  }
  if (segStart !== -1 && rms.length - segStart >= minRoundFrames) {
    segments.push([segStart, rms.length]);
  }

  return segments.map(([a, b], index) => ({
    index,
    startSec: rangeStart + a * hopSec,
    endSec: rangeStart + b * hopSec,
    text: "",
  }));
}
