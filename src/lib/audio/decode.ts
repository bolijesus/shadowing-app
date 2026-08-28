"use client";

/**
 * Decodificación de audio para la onda y el análisis.
 *
 * Se decodifica a 16 kHz mono: `decodeAudioData` remuestrea al ritmo del
 * contexto, así que el PCM ocupa unas tres veces menos que a 48 kHz. §13.6
 * dice que 16 kHz basta para analizar, y el F0 sigue funcionando (la ventana
 * de 40 ms da 1024 muestras, de sobra para bajar hasta 60 Hz).
 *
 * Lo que sigue pendiente (§13.7): decodificar SOLO el rango pedido. Hoy hay
 * que leer el archivo entero para poder decodificarlo, así que un capítulo
 * largo tarda la primera vez. El resultado se cachea por clip en OPFS, de
 * modo que es un coste único.
 */

export const ANALYSIS_SAMPLE_RATE = 16000;

/** Por encima de esto se avisa de que la primera onda va a tardar. */
export const SLOW_DECODE_BYTES = 150 * 1024 * 1024;

export const MAX_DECODE_BYTES = 2 * 1024 * 1024 * 1024;

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

  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  // El contexto se crea ANTES de leer el archivo: si el navegador rechaza
  // los 16 kHz lo hace aquí, en el constructor. Decidirlo después no valdría,
  // porque decodeAudioData desacopla el ArrayBuffer y no se puede reintentar
  // con el mismo búfer.
  let tmp: OfflineAudioContext;
  try {
    tmp = new OfflineCtor(1, 1, ANALYSIS_SAMPLE_RATE);
  } catch {
    tmp = new OfflineCtor(1, 1, 44100);
  }

  const buf = await file.arrayBuffer();
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
