"use client";

import * as Comlink from "comlink";
import { blobExists, readBlob } from "@/lib/storage/opfs";
import { putBlob } from "@/lib/storage/blobStore";
import {
  deserializeAnalysis,
  serializeAnalysis,
  analysisPath,
  dsp,
  type Analysis,
} from "./analysis";
import { decodeRange, FileTooLargeToDecode, MAX_DECODE_BYTES } from "./decode";
import { captureRangeAudio, type CaptureProgress } from "./captureFallback";

/**
 * Análisis de un recorte, decodificando UNA sola vez.
 *
 * Antes cada pieza —los picos del recorte y el análisis de cada ronda— leía y
 * decodificaba el archivo entero por su cuenta, y encima en el hilo principal.
 * Con un capítulo de 22 minutos y cinco rondas eran seis decodificaciones
 * completas: de ahí que el navegador se congelara al entrar en la práctica, y
 * que a la segunda fuera bien (ya estaba todo en caché).
 *
 * Ahora se decodifica el recorte una vez dentro del worker y cada ronda sale
 * de ese mismo buffer. §6 lo pide explícitamente: nada pesado en el hilo de UI.
 */

/** Identifica el recorte decodificado que el worker tiene en memoria. */
function tokenFor(clipId: string, startSec: number, endSec: number): string {
  return `${clipId}:${Math.round(startSec * 1000)}:${Math.round(endSec * 1000)}`;
}

let loading: Promise<string> | null = null;
let loadedToken = "";

/**
 * Se asegura de que el recorte esté decodificado en el worker. Varias
 * llamadas simultáneas comparten la misma promesa: si no, los efectos del
 * reproductor dispararían dos decodificaciones a la vez, que es justo lo que
 * colgaba el navegador.
 */
export interface LoadOptions {
  /** Se llama si hay que recurrir a la captura en tiempo real. */
  onFallback?: () => void;
  onCaptureProgress?: (p: CaptureProgress) => void;
}

export async function ensureClipLoaded(
  file: Blob,
  clipId: string,
  startSec: number,
  endSec: number,
  { onFallback, onCaptureProgress }: LoadOptions = {},
): Promise<string> {
  const token = tokenFor(clipId, startSec, endSec);
  if (loadedToken === token && (await dsp().hasRange(token))) return token;
  if (loading) {
    const t = await loading;
    if (t === token) return token;
  }

  if (file.size > MAX_DECODE_BYTES) throw new FileTooLargeToDecode(file.size);

  loading = (async () => {
    // La decodificación va aquí, en el hilo principal, porque Web Audio solo
    // existe en Window: OfflineAudioContext no está disponible en un worker.
    // Lo que sí se evita es repetirla: se hace UNA vez por recorte y al
    // worker solo viajan las muestras resultantes, que son pocos MB.
    let pcm: Float32Array;
    let sampleRate: number;
    try {
      const d = await decodeRange(file, startSec, endSec);
      pcm = d.pcm;
      sampleRate = d.sampleRate;
    } catch (e) {
      // Hay códecs que el navegador reproduce pero decodeAudioData no sabe
      // decodificar (AC-3, algunos AAC, MKV). Antes de rendirse se captura
      // el audio reproduciéndolo, que funciona con cualquier cosa que suene.
      if (!looksLikeDecodeFailure(e)) throw e;
      onFallback?.();
      const cap = await captureRangeAudio(
        file,
        startSec,
        endSec,
        onCaptureProgress,
      );
      // La grabación lleva margen por delante y por detrás: se recorta por
      // donde el reloj del medio dice que empieza el rango. Si se tomara
      // entera, la onda saldría desplazada respecto al vídeo.
      const d = await decodeRange(
        cap.blob,
        cap.offsetSec,
        cap.offsetSec + cap.durationSec,
      );
      pcm = d.pcm;
      sampleRate = d.sampleRate;
    }

    const t = pcm.slice(0);
    await dsp().loadPcm(
      Comlink.transfer(t, [t.buffer]) as unknown as Float32Array,
      sampleRate,
      token,
    );
    loadedToken = token;
    return token;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * Análisis de una ronda. Los tiempos son absolutos del medio; dentro se
 * traducen a la posición relativa dentro del recorte ya decodificado.
 */
export async function roundAnalysis(
  file: Blob,
  clipId: string,
  clipStartSec: number,
  clipEndSec: number,
  roundId: string,
  roundStartSec: number,
  roundEndSec: number,
  buckets = 800,
  opts: LoadOptions = {},
): Promise<Analysis> {
  const path = analysisPath("round", roundId, roundStartSec, roundEndSec);
  if (await blobExists(path)) {
    try {
      return deserializeAnalysis(await readBlob(path));
    } catch {
      /* formato viejo: se recalcula */
    }
  }

  const token = await ensureClipLoaded(
    file,
    clipId,
    clipStartSec,
    clipEndSec,
    opts,
  );
  const a = await dsp().analyzeSub(
    token,
    Math.max(0, roundStartSec - clipStartSec),
    Math.max(0, roundEndSec - clipStartSec),
    buckets,
  );
  if (!a) throw new Error("No se pudo analizar esta ronda.");
  await putBlob(path, serializeAnalysis(a), "analysis", roundId);
  return a;
}

/**
 * Extrae un rango como WAV mono 16 kHz, con el mismo plan B de captura.
 * Es lo que usa "Generar transcripción": así no vuelve a fallar por códec.
 */
export async function extractRange(
  file: Blob,
  clipId: string,
  startSec: number,
  endSec: number,
  opts: LoadOptions = {},
): Promise<Blob> {
  const token = await ensureClipLoaded(file, clipId, startSec, endSec, opts);
  const wav = await dsp().wavOf(token);
  if (!wav) throw new Error("No se pudo extraer el audio del recorte.");
  return new Blob([wav], { type: "audio/wav" });
}

/**
 * ¿Merece la pena intentar el plan B?
 *
 * Se prueba salvo que el problema sea de tamaño, donde capturar tampoco
 * ayudaría. Los mensajes de decodificación varían mucho entre navegadores
 * ("Unable to decode audio data", "EncodingError", "The buffer passed to
 * decodeAudioData contains an unknown content type"), así que filtrar por
 * texto dejaba fuera casos reales.
 */
function looksLikeDecodeFailure(e: unknown): boolean {
  return !(e instanceof FileTooLargeToDecode);
}

/** Libera el PCM del worker al salir de la práctica. */
export function releaseClip(): void {
  loadedToken = "";
  void dsp().releaseRange();
}
