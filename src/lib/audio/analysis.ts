"use client";

import * as Comlink from "comlink";
import type { Analysis, AudioDspApi, Peaks } from "@/workers/audio-dsp.worker";
import { blobExists, readBlob } from "@/lib/storage/opfs";
import { putBlob } from "@/lib/storage/blobStore";
import { decodeRange } from "./decode";
import { rangeTag } from "./peaks";

let _dsp: Comlink.Remote<AudioDspApi> | null = null;

export function dsp(): Comlink.Remote<AudioDspApi> {
  if (!_dsp) {
    const worker = new Worker(
      new URL("../../workers/audio-dsp.worker.ts", import.meta.url),
      { type: "module", name: "audio-dsp" },
    );
    _dsp = Comlink.wrap<AudioDspApi>(worker);
  }
  return _dsp;
}

/** Envía el PCM al worker como transferible (sin copia). */
async function analyzePcm(
  pcm: Float32Array,
  sampleRate: number,
  buckets: number,
): Promise<Analysis> {
  const t = pcm.slice(0);
  return dsp().analyze(
    Comlink.transfer(t, [t.buffer]) as unknown as Float32Array,
    sampleRate,
    buckets,
  );
}

/**
 * Analiza un rango del medio. Solo se decodifica el rango pedido (§5),
 * el resto del archivo nunca llega a PCM.
 */
export async function analyzeRange(
  file: Blob,
  startSec: number,
  endSec: number,
  buckets = 800,
): Promise<Analysis> {
  const { pcm, sampleRate } = await decodeRange(file, startSec, endSec);
  return analyzePcm(pcm, sampleRate, buckets);
}

/**
 * Analiza una grabación completa, descontando la latencia de captura
 * antes de ventanear (§13.5): si no, todas las notas de ritmo salen bajas.
 */
export async function analyzeTake(
  blob: Blob,
  latencyOffsetMs: number,
  buckets = 800,
): Promise<Analysis> {
  const { pcm, sampleRate } = await decodeRange(
    blob,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const skip = Math.min(
    pcm.length,
    Math.max(0, Math.round((latencyOffsetMs / 1000) * sampleRate)),
  );
  const trimmed = skip > 0 ? pcm.subarray(skip) : pcm;
  return analyzePcm(trimmed, sampleRate, buckets);
}

/* ---------- serialización compacta del análisis en OPFS ---------- */

const MAGIC = 0x53484131; // "SHA1"

function bytesOf(arr: Float32Array): ArrayBuffer {
  const out = new Uint8Array(arr.byteLength);
  out.set(new Uint8Array(arr.buffer as ArrayBuffer, arr.byteOffset, arr.byteLength));
  return out.buffer;
}

function writeArray(parts: ArrayBuffer[], arr: Float32Array) {
  const len = new Uint32Array([arr.length]);
  parts.push(len.buffer.slice(0));
  parts.push(bytesOf(arr));
}

export function serializeAnalysis(a: Analysis): ArrayBuffer {
  const head = new ArrayBuffer(28);
  const dv = new DataView(head);
  dv.setUint32(0, MAGIC);
  dv.setUint32(4, a.peaks.buckets);
  dv.setFloat32(8, a.durationSec);
  dv.setFloat32(12, a.medianHz);
  dv.setFloat32(16, a.f0HopSec);
  dv.setFloat32(20, a.energyHopSec);
  dv.setUint32(24, a.pauses.length);

  const parts: ArrayBuffer[] = [head];
  const pauseArr = new Float32Array(a.pauses.flat());
  parts.push(bytesOf(pauseArr));
  writeArray(parts, a.peaks.minmax);
  writeArray(parts, a.semitones);
  writeArray(parts, a.hz);
  writeArray(parts, a.energy);

  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), off);
    off += p.byteLength;
  }
  return out.buffer;
}

export function deserializeAnalysis(buf: ArrayBuffer): Analysis {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== MAGIC) throw new Error("Formato de análisis inválido");
  const buckets = dv.getUint32(4);
  const durationSec = dv.getFloat32(8);
  const medianHz = dv.getFloat32(12);
  const f0HopSec = dv.getFloat32(16);
  const energyHopSec = dv.getFloat32(20);
  const pauseCount = dv.getUint32(24);

  let off = 28;
  const flat = new Float32Array(buf.slice(off, off + pauseCount * 2 * 4));
  off += pauseCount * 2 * 4;
  const pauses: [number, number][] = [];
  for (let i = 0; i < pauseCount; i++) {
    pauses.push([flat[i * 2]!, flat[i * 2 + 1]!]);
  }

  const read = (): Float32Array => {
    const len = new DataView(buf, off).getUint32(0, true);
    off += 4;
    const arr = new Float32Array(buf.slice(off, off + len * 4));
    off += len * 4;
    return arr;
  };

  const minmax = read();
  const semitones = read();
  const hz = read();
  const energy = read();

  return {
    peaks: { minmax, buckets, durationSec },
    semitones,
    hz,
    medianHz,
    f0HopSec,
    energy,
    energyHopSec,
    pauses,
    durationSec,
    sampleRate: 0,
  };
}

/**
 * Igual que con los picos: la clave lleva el rango. Un análisis cacheado por
 * id a secas sobrevivía a unir/partir rondas y devolvía la curva del rango
 * viejo, que es justo lo que descuadraba la entonación respecto al audio.
 */
export function analysisPath(
  kind: "round" | "take",
  id: string,
  startSec?: number,
  endSec?: number,
): string {
  const tag =
    startSec === undefined ? "" : `_${rangeTag(startSec, endSec ?? 0)}`;
  return `analysis/${kind}_${id}${tag}.bin`;
}

/** Análisis del modelo por ronda, cacheado en OPFS. */
export async function getOrBuildRoundAnalysis(
  roundId: string,
  file: Blob,
  startSec: number,
  endSec: number,
): Promise<Analysis> {
  const path = analysisPath("round", roundId, startSec, endSec);
  if (await blobExists(path)) {
    try {
      return deserializeAnalysis(await readBlob(path));
    } catch {
      /* formato viejo: se recalcula */
    }
  }
  const a = await analyzeRange(file, startSec, endSec);
  await putBlob(path, serializeAnalysis(a), "analysis", roundId);
  return a;
}

export async function saveTakeAnalysis(
  takeId: string,
  a: Analysis,
): Promise<string> {
  const path = analysisPath("take", takeId);
  await putBlob(path, serializeAnalysis(a), "analysis", takeId);
  return path;
}

export async function loadAnalysis(path: string): Promise<Analysis | null> {
  try {
    if (!(await blobExists(path))) return null;
    return deserializeAnalysis(await readBlob(path));
  } catch {
    return null;
  }
}

export type { Analysis, Peaks };
