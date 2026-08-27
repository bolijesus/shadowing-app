"use client";

/**
 * Decodificación de audio para la forma de onda.
 *
 * Fase 1: se decodifica el archivo con decodeAudioData y se extrae solo el
 * rango pedido; los picos resultantes se cachean en OPFS y no se vuelve a
 * decodificar. La decodificación parcial por demuxing queda para Fase 2
 * (§13.7). Guarda de tamaño para no agotar memoria con archivos enormes.
 */

export const MAX_DECODE_BYTES = 300 * 1024 * 1024;

export class FileTooLargeToDecode extends Error {
  constructor(public bytes: number) {
    super("Archivo demasiado grande para generar la onda en esta versión");
  }
}

export interface DecodedRange {
  pcm: Float32Array; // mono, mezcla de canales
  sampleRate: number;
  startSec: number;
  endSec: number;
}

export async function decodeRange(
  file: Blob,
  startSec: number,
  endSec: number,
): Promise<DecodedRange> {
  if (file.size > MAX_DECODE_BYTES) throw new FileTooLargeToDecode(file.size);

  const buf = await file.arrayBuffer();
  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  // Contexto efímero solo para decodificar.
  const tmp = new OfflineCtor(1, 1, 44100);
  const audioBuf = await tmp.decodeAudioData(buf);

  const sr = audioBuf.sampleRate;
  const from = Math.max(0, Math.floor(startSec * sr));
  const to = Math.min(audioBuf.length, Math.ceil(endSec * sr));
  const len = Math.max(0, to - from);
  const mono = new Float32Array(len);

  for (let ch = 0; ch < audioBuf.numberOfChannels; ch++) {
    const data = audioBuf.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i]! += data[from + i]! / audioBuf.numberOfChannels;
  }

  return {
    pcm: mono,
    sampleRate: sr,
    startSec,
    endSec: from / sr + len / sr,
  };
}
