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
import {
  deserializePeaks,
  peaksPath,
  serializePeaks,
  type Peaks,
} from "./peaks";
import { FileTooLargeToDecode, MAX_DECODE_BYTES } from "./decode";

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
export async function ensureClipLoaded(
  file: Blob,
  clipId: string,
  startSec: number,
  endSec: number,
): Promise<string> {
  const token = tokenFor(clipId, startSec, endSec);
  if (loadedToken === token && (await dsp().hasRange(token))) return token;
  if (loading) {
    const t = await loading;
    if (t === token) return token;
  }

  if (file.size > MAX_DECODE_BYTES) throw new FileTooLargeToDecode(file.size);

  loading = (async () => {
    const bytes = await file.arrayBuffer();
    await dsp().loadRange(
      Comlink.transfer(bytes, [bytes]) as unknown as ArrayBuffer,
      startSec,
      endSec,
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

/** Picos del recorte completo, con caché en OPFS. */
export async function clipPeaks(
  file: Blob,
  clipId: string,
  startSec: number,
  endSec: number,
  buckets = 800,
): Promise<Peaks> {
  const path = peaksPath(clipId, startSec, endSec);
  if (await blobExists(path)) {
    try {
      return deserializePeaks(await readBlob(path));
    } catch {
      /* formato viejo: se recalcula */
    }
  }
  const token = await ensureClipLoaded(file, clipId, startSec, endSec);
  const peaks = await dsp().peaksOf(token, buckets);
  if (!peaks) throw new Error("No se pudo calcular la onda del recorte.");
  await putBlob(path, serializePeaks(peaks), "analysis", clipId);
  return peaks;
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
): Promise<Analysis> {
  const path = analysisPath("round", roundId, roundStartSec, roundEndSec);
  if (await blobExists(path)) {
    try {
      return deserializeAnalysis(await readBlob(path));
    } catch {
      /* formato viejo: se recalcula */
    }
  }

  const token = await ensureClipLoaded(file, clipId, clipStartSec, clipEndSec);
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

/** Libera el PCM del worker al salir de la práctica. */
export function releaseClip(): void {
  loadedToken = "";
  void dsp().releaseRange();
}
