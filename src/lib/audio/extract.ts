"use client";

import { decodeRange } from "./decode";

/**
 * Extrae un rango del medio como WAV mono 16 kHz.
 *
 * Sirve para dos cosas del prompt: transcribir SOLO el tramo elegido en vez
 * del archivo entero (§5), y materializar un recorte cuando el usuario lo
 * pide explícitamente (§5, "Exportar recorte").
 *
 * 16 kHz mono es lo que quiere Whisper y lo que §13.6 da por suficiente para
 * analizar; además pesa poco, que importa si se guarda.
 */

export const EXTRACT_SAMPLE_RATE = 16000;

/** Codifica PCM mono en WAV de 16 bits. */
export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(out);
  const ascii = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i));
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
}

export async function extractRangeAsWav(
  file: Blob,
  startSec: number,
  endSec: number,
): Promise<Blob> {
  const { pcm, sampleRate } = await decodeRange(file, startSec, endSec);
  return new Blob([encodeWav(pcm, sampleRate)], { type: "audio/wav" });
}

/** Tamaño que ocuparía el recorte, para avisar antes de escribirlo (§5). */
export function estimateWavBytes(
  durationSec: number,
  sampleRate = EXTRACT_SAMPLE_RATE,
): number {
  return 44 + Math.round(durationSec * sampleRate) * 2;
}
