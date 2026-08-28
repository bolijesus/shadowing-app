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

function describeDevice(): string {
  if (!loadedDtype) return loadedDevice;
  return `${loadedDevice}/${loadedDtype}${loadedOptimized ? "" : "/sin-optimizar"}`;
}

let pipe: Pipe | null = null;
let loadedModel = "";
let loadedDevice: "webgpu" | "wasm" = "wasm";
type Dtype = "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4" | "bnb4";
let loadedDtype: Dtype | "" = "";
let loadedOptimized = true;

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

  const build = async (
    device: "webgpu" | "wasm",
    dtype: Dtype,
    optimize: boolean,
  ) =>
    (await pipeline("automatic-speech-recognition", model, {
      device,
      dtype,
      // El fallo "TransposeDQWeightsForMatMulNBits / Missing required scale"
      // ocurre DENTRO del optimizador de grafos de onnxruntime
      // (qdq_actions.cc), no al ejecutar el modelo. Desactivarlo evita ese
      // paso; el modelo corre igual, algo más lento.
      session_options: optimize ? undefined : { graphOptimizationLevel: "disabled" },
      progress_callback: onProgress as never,
    } as never)) as unknown as Pipe;

  // No basta con que exista navigator.gpu: puede estar el API y no haber
  // adaptador (GPU sin soporte, driver bloqueado, máquina virtual). Hay que
  // pedirlo de verdad, o se elige WebGPU y luego revienta al construir.
  const gpu = await webGpuUsable();

  /**
   * Escalera de configuraciones, de la más ligera a la más compatible.
   *
   * Se combinan tres ejes: dispositivo, cuantización y optimización de
   * grafos. Este último importa: hay versiones de onnxruntime que revientan
   * al optimizar ciertos modelos, y ahí falla igual con o sin cuantizar, así
   * que probar solo dtypes no bastaba.
   */
  const ladder: {
    device: "webgpu" | "wasm";
    dtype: Dtype;
    optimize: boolean;
  }[] = [
    ...(gpu
      ? [
          { device: "webgpu" as const, dtype: "fp32" as Dtype, optimize: true },
          { device: "webgpu" as const, dtype: "fp32" as Dtype, optimize: false },
        ]
      : []),
    { device: "wasm" as const, dtype: "q8" as Dtype, optimize: true },
    { device: "wasm" as const, dtype: "q8" as Dtype, optimize: false },
    { device: "wasm" as const, dtype: "fp32" as Dtype, optimize: false },
    { device: "wasm" as const, dtype: "int8" as Dtype, optimize: false },
  ];

  const failures: string[] = [];
  for (const step of ladder) {
    try {
      pipe = await build(step.device, step.dtype, step.optimize);
      loadedDevice = step.device;
      loadedDtype = step.dtype;
      loadedOptimized = step.optimize;
      break;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
      failures.push(
        `${step.device}/${step.dtype}${step.optimize ? "" : "/sin-optimizar"}: ${msg.slice(0, 120)}`,
      );
    }
  }

  if (!pipe) {
    throw new Error(
      `Ninguna configuración arrancó.\n${failures.join("\n")}`,
    );
  }

  loadedModel = model;
  return pipe;
}

const api = {
  /** Descarga y compila el modelo, informando del progreso. */
  async warmup(model: string, onProgress?: ProgressCb): Promise<string> {
    await ensurePipeline(model, onProgress ? Comlink.proxy(onProgress) : undefined);
    return describeDevice();
  },

  device(): string {
    return describeDevice();
  },

  /**
   * `pcm` llega ya como mono a 16 kHz. La conversión se hace en el hilo
   * principal a propósito: Web Audio (AudioContext / OfflineAudioContext)
   * solo está expuesto en Window, no en workers, así que decodificar aquí
   * fallaba con "Ctor is not a constructor".
   */
  async transcribe(
    pcm: Float32Array,
    language: string,
    model: string,
    onProgress?: ProgressCb,
  ): Promise<AsrResult> {
    const p = await ensurePipeline(model, onProgress);
    const audio = pcm;

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
    loadedDtype = "";
  },
};

export type AsrWorkerApi = typeof api;
Comlink.expose(api);
