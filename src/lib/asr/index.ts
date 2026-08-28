"use client";

import * as Comlink from "comlink";
import { getKeystore, modelFor } from "@/lib/crypto/keystore";
import type { AsrWorkerApi } from "@/workers/asr.worker";
import { apiEngine, browserSpeechSupported } from "./providers";
import {
  AsrError,
  DEFAULT_WHISPER,
  whisperModelInfo,
  type AsrEngineId,
  type AsrResult,
} from "./types";

/**
 * Orquestador de ASR. Orden de preferencia de §6.4: Whisper local primero
 * (offline, privado y gratis), después API si hay key, y el dictado del
 * navegador como último recurso.
 */

let proxy: Comlink.Remote<AsrWorkerApi> | null = null;
let worker: Worker | null = null;

function asrWorker(): Comlink.Remote<AsrWorkerApi> {
  if (!proxy) {
    worker = new Worker(new URL("../../workers/asr.worker.ts", import.meta.url), {
      type: "module",
      name: "asr",
    });
    proxy = Comlink.wrap<AsrWorkerApi>(worker);
  }
  return proxy;
}

export function releaseAsrWorker(): void {
  worker?.terminate();
  worker = null;
  proxy = null;
}

/** Motor elegido en Ajustes, o el local por defecto. */
export function selectedEngine(): AsrEngineId {
  const ks = getKeystore();
  const sel = ks?.selected?.asr;
  return (sel as AsrEngineId) ?? "whisper-local";
}

export function selectedWhisperModel(): string {
  const cfg = getKeystore()?.providers["whisper-local"];
  return modelFor(cfg, "asr") ?? DEFAULT_WHISPER;
}

export function engineDownloadMb(engine: AsrEngineId): number {
  if (engine !== "whisper-local") return 0;
  return whisperModelInfo(selectedWhisperModel())?.mb ?? 45;
}

export interface AsrProgress {
  status: string;
  progress?: number;
  file?: string;
}

/** ¿Está listo el motor para usarse sin descargar nada? */
export function engineReady(engine: AsrEngineId = selectedEngine()): boolean {
  if (engine === "browser") return browserSpeechSupported();
  if (engine === "whisper-local") return false; // lo dirá la caché de modelos
  const cfg = getKeystore()?.providers[engine];
  return !!cfg?.apiKey || !!cfg?.proxyUrl;
}

/** Descarga y compila el modelo local, informando del progreso. */
export async function warmupLocal(
  onProgress?: (p: AsrProgress) => void,
): Promise<string> {
  return asrWorker().warmup(
    selectedWhisperModel(),
    onProgress ? Comlink.proxy(onProgress) : undefined,
  );
}

/**
 * Transcribe una grabación. Nunca lanza por falta de configuración: si el
 * motor no puede, devuelve null y quien llame decide. Así el flujo de
 * práctica no se rompe por no tener ASR (§13.9: mejor sin nota que con una
 * nota inventada).
 */
export async function transcribe(
  audio: Blob,
  language: string,
  opts: { engine?: AsrEngineId; onProgress?: (p: AsrProgress) => void } = {},
): Promise<AsrResult | null> {
  const engine = opts.engine ?? selectedEngine();

  if (engine === "whisper-local") {
    try {
      // Se decodifica a 16 kHz mono aquí, no en el worker: Web Audio solo
      // existe en Window. Al worker solo viajan las muestras.
      const { decodeRange, ANALYSIS_SAMPLE_RATE } = await import(
        "@/lib/audio/decode"
      );
      const { pcm, sampleRate } = await decodeRange(
        audio,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      // Whisper espera 16 kHz exactos. decodeRange los da salvo que el
      // navegador rechace esa frecuencia y caiga a 44,1: entonces hay que
      // remuestrear, o el modelo interpreta mal el audio y devuelve basura.
      const t =
        sampleRate === ANALYSIS_SAMPLE_RATE
          ? pcm.slice(0)
          : resampleTo16k(pcm, sampleRate);
      return await asrWorker().transcribe(
        Comlink.transfer(t, [t.buffer]) as unknown as Float32Array,
        language,
        selectedWhisperModel(),
        opts.onProgress ? Comlink.proxy(opts.onProgress) : undefined,
      );
    } catch (e) {
      throw new AsrError(
        e instanceof Error
          ? `Whisper local: ${e.message}`
          : "Whisper local falló.",
      );
    }
  }

  const eng = apiEngine(engine);
  if (!eng) return null;

  const cfg = getKeystore()?.providers[engine];
  if (eng.needsApiKey && !cfg?.apiKey && !cfg?.proxyUrl) {
    throw new AsrError(
      `${eng.label} necesita una API key. Configúrala en Ajustes o cambia a Whisper local.`,
    );
  }

  return eng.transcribe(
    { audio, language },
    {
      apiKey: cfg?.apiKey,
      proxyUrl: cfg?.proxyUrl,
      model: modelFor(cfg, "asr"),
    },
  );
}

/** Remuestreo lineal a 16 kHz, solo para el caso raro de arriba. */
function resampleTo16k(pcm: Float32Array, fromRate: number): Float32Array {
  const ratio = 16000 / fromRate;
  const out = new Float32Array(Math.max(1, Math.round(pcm.length * ratio)));
  for (let i = 0; i < out.length; i++) {
    const pos = i / ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(pcm.length - 1, lo + 1);
    const f = pos - lo;
    out[i] = (pcm[lo] ?? 0) * (1 - f) + (pcm[hi] ?? 0) * f;
  }
  return out;
}

export { AsrError };
export type { AsrResult };
export * from "./types";

/**
 * Agrupa palabras con tiempos en cues aprovechables como subtítulos.
 * Corta en la puntuación fuerte y, si no la hay, en los silencios largos o
 * al pasarse de `maxSec`, para que ninguna ronda salga inabordable.
 */
export function cuesFromWords(
  words: { text: string; start: number; end: number }[],
  offsetSec = 0,
  maxSec = 10,
): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let buf: typeof words = [];

  const flush = () => {
    if (!buf.length) return;
    out.push({
      start: offsetSec + buf[0]!.start,
      end: offsetSec + buf[buf.length - 1]!.end,
      text: buf.map((w) => w.text).join(" ").replace(/\s+([,.;:!?])/g, "$1").trim(),
    });
    buf = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = words[i - 1];
    // Un hueco largo entre palabras es un cambio de frase aunque no haya punto.
    if (buf.length && prev && w.start - prev.end > 0.6) flush();
    buf.push(w);

    const spans = w.end - buf[0]!.start;
    if (/[.!?…。！？]["'»)\]]*$/.test(w.text) || spans >= maxSec) flush();
  }
  flush();
  return out.filter((c) => c.text && c.end > c.start);
}
