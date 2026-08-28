/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { AsrResult, AsrWord } from "@/lib/asr/types";

/**
 * Whisper local con transformers.js (§6.4).
 *
 * Worker de larga vida: el modelo se queda en memoria entre transcripciones.
 * El import es dinámico a propósito — la librería y el modelo pesan decenas de
 * MB y §2 prohíbe que entren en el bundle inicial.
 *
 * WebGPU si existe; si no, WASM de UN hilo. El multihilo pediría aislamiento
 * cross-origin (COOP/COEP), y eso rompería el embed de YouTube, así que no se
 * activa: es la decisión D1 del proyecto.
 */

type ProgressCb = (p: { status: string; progress?: number; file?: string }) => void;

interface Pipe {
  (
    audio: Float32Array,
    opts: Record<string, unknown>,
  ): Promise<{
    text: string;
    chunks?: { text: string; timestamp: [number, number | null] }[];
  }>;
}

let pipe: Pipe | null = null;
let loadedModel = "";
let loadedDevice: "webgpu" | "wasm" = "wasm";

async function ensurePipeline(
  model: string,
  onProgress?: ProgressCb,
): Promise<Pipe> {
  if (pipe && loadedModel === model) return pipe;

  const tf = await import("@huggingface/transformers");
  const { pipeline, env } = tf;

  // Un solo hilo: ver arriba por qué no se usa el multihilo.
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

  const hasWebGpu =
    typeof navigator !== "undefined" &&
    !!(navigator as Navigator & { gpu?: unknown }).gpu;
  loadedDevice = hasWebGpu ? "webgpu" : "wasm";

  const build = async (device: "webgpu" | "wasm") =>
    (await pipeline("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: onProgress as never,
    })) as unknown as Pipe;

  try {
    pipe = await build(loadedDevice);
  } catch {
    // Algunas GPU fallan al compilar los shaders: se cae a WASM en vez de
    // dejar al usuario sin transcripción.
    loadedDevice = "wasm";
    pipe = await build("wasm");
  }
  loadedModel = model;
  return pipe;
}

/** Whisper trabaja a 16 kHz mono. */
async function toMono16k(bytes: ArrayBuffer): Promise<Float32Array> {
  const OfflineCtor =
    (self as unknown as { OfflineAudioContext: typeof OfflineAudioContext })
      .OfflineAudioContext;
  const ctx = new OfflineCtor(1, 1, 16000);
  const buf = await ctx.decodeAudioData(bytes);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < buf.length; i++) out[i]! += d[i]! / buf.numberOfChannels;
  }
  return out;
}

const api = {
  /** Descarga y compila el modelo, informando del progreso. */
  async warmup(model: string, onProgress?: ProgressCb): Promise<string> {
    await ensurePipeline(model, onProgress ? Comlink.proxy(onProgress) : undefined);
    return loadedDevice;
  },

  device(): string {
    return loadedDevice;
  },

  async transcribe(
    bytes: ArrayBuffer,
    language: string,
    model: string,
    onProgress?: ProgressCb,
  ): Promise<AsrResult> {
    const p = await ensurePipeline(model, onProgress);
    const audio = await toMono16k(bytes);

    const base = language.split("-")[0]!.toLowerCase();
    const englishOnly = model.endsWith(".en");

    const res = await p(audio, {
      // Tiempos por palabra: es lo que vuelve exacto el karaoke (§6.4).
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(englishOnly ? {} : { language: base, task: "transcribe" }),
    });

    const words: AsrWord[] = (res.chunks ?? [])
      .filter((c) => c.text?.trim())
      .map((c) => ({
        text: c.text.trim(),
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? c.timestamp[0] ?? 0,
      }));

    return {
      text: (res.text ?? "").trim(),
      words: words.length ? words : undefined,
      engine: "whisper-local",
      language: base,
    };
  },

  release(): void {
    pipe = null;
    loadedModel = "";
  },
};

export type AsrWorkerApi = typeof api;
Comlink.expose(api);
