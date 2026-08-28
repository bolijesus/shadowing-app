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

/**
 * ¿Hay WebGPU de verdad? Comprobar `navigator.gpu` no basta: el API puede
 * existir y `requestAdapter()` devolver null en máquinas sin GPU compatible,
 * con el driver en lista negra o en una máquina virtual.
 */
async function webGpuUsable(): Promise<boolean> {
  const gpu = (navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<unknown> };
  }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
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

  if (env.backends?.onnx?.wasm) {
    // Un solo hilo: ver arriba por qué no se usa el multihilo.
    env.backends.onnx.wasm.numThreads = 1;
    // Auto-hospedados en /public/ort. Sin esto onnxruntime los busca en un
    // CDN y, si no hay red o está bloqueado, falla con "no available backend
    // found" y se queda sin WebGPU Y sin WASM. La app debe ir offline (§1.6).
    env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;
  }

  const build = async (device: "webgpu" | "wasm") =>
    (await pipeline("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: onProgress as never,
    })) as unknown as Pipe;

  // No basta con que exista navigator.gpu: puede estar el API y no haber
  // adaptador (GPU sin soporte, driver bloqueado, máquina virtual). Hay que
  // pedirlo de verdad, o se elige WebGPU y luego revienta.
  loadedDevice = (await webGpuUsable()) ? "webgpu" : "wasm";

  try {
    pipe = await build(loadedDevice);
  } catch (e) {
    if (loadedDevice === "wasm") {
      throw new Error(
        `No se pudo iniciar el motor de voz: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    // La GPU falló al compilar los shaders: se cae a CPU en vez de dejarte
    // sin transcripción.
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
