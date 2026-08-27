"use client";

import * as Comlink from "comlink";
import type { AudioDspApi, Peaks } from "@/workers/audio-dsp.worker";
import { blobExists, readBlob } from "@/lib/storage/opfs";
import { putBlob } from "@/lib/storage/blobStore";
import { decodeRange } from "./decode";

let _dsp: Comlink.Remote<AudioDspApi> | null = null;
function dsp(): Comlink.Remote<AudioDspApi> {
  if (!_dsp) {
    const worker = new Worker(
      new URL("../../workers/audio-dsp.worker.ts", import.meta.url),
      { type: "module", name: "audio-dsp" },
    );
    _dsp = Comlink.wrap<AudioDspApi>(worker);
  }
  return _dsp;
}

const MAGIC = 0x53485750; // "SHWP"

export function serializePeaks(p: Peaks): ArrayBuffer {
  const header = new ArrayBuffer(16);
  const dv = new DataView(header);
  dv.setUint32(0, MAGIC);
  dv.setUint32(4, p.buckets);
  dv.setFloat32(8, p.durationSec);
  dv.setUint32(12, p.minmax.length);
  const bytes = new Uint8Array(16 + p.minmax.byteLength);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(p.minmax.buffer.slice(0)), 16);
  return bytes.buffer;
}

export function deserializePeaks(buf: ArrayBuffer): Peaks {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== MAGIC) throw new Error("Formato de picos inválido");
  const buckets = dv.getUint32(4);
  const durationSec = dv.getFloat32(8);
  const len = dv.getUint32(12);
  const minmax = new Float32Array(buf.slice(16, 16 + len * 4));
  return { minmax, buckets, durationSec };
}

export function peaksPath(clipId: string): string {
  return `analysis/peaks_${clipId}.bin`;
}

export interface BuildPeaksArgs {
  clipId: string;
  file: Blob;
  startSec: number;
  endSec: number;
  buckets?: number;
}

/** Calcula picos de un blob completo (p. ej. una toma) sin cachear. */
export async function computePeaksFromBlob(
  blob: Blob,
  buckets = 800,
): Promise<Peaks> {
  const { pcm, sampleRate } = await decodeRange(blob, 0, Number.MAX_SAFE_INTEGER);
  const t = pcm.slice(0);
  return dsp().computePeaks(
    Comlink.transfer(t, [t.buffer]),
    sampleRate,
    buckets,
  );
}

/** Devuelve picos desde OPFS si existen; si no, los calcula y cachea. */
export async function getOrBuildPeaks(args: BuildPeaksArgs): Promise<Peaks> {
  const path = peaksPath(args.clipId);
  if (await blobExists(path)) {
    return deserializePeaks(await readBlob(path));
  }
  const { pcm, sampleRate } = await decodeRange(args.file, args.startSec, args.endSec);
  const transferable = pcm.slice(0);
  const peaks = await dsp().computePeaks(
    Comlink.transfer(transferable, [transferable.buffer]),
    sampleRate,
    args.buckets ?? 800,
  );
  await putBlob(path, serializePeaks(peaks), "analysis", args.clipId);
  return peaks;
}
