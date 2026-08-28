/** Contrato común de los motores de reconocimiento de voz (§6.4). */

export type AsrEngineId =
  | "whisper-local"
  | "openai"
  | "gemini"
  | "deepgram"
  | "browser";

export interface AsrWord {
  text: string;
  start: number;
  end: number;
}

export interface AsrResult {
  text: string;
  /** Tiempos por palabra cuando el motor los da (§6.4). */
  words?: AsrWord[];
  engine: AsrEngineId;
  language?: string;
}

export interface AsrCredentials {
  apiKey?: string;
  model?: string;
  proxyUrl?: string;
}

export interface AsrRequest {
  audio: Blob;
  language: string;
  /** Texto esperado, si se conoce: algunos motores lo aceptan como pista. */
  hint?: string;
}

export interface AsrEngine {
  id: AsrEngineId;
  label: string;
  needsApiKey: boolean;
  /** Funciona sin conexión una vez descargado. */
  offline: boolean;
  /** Devuelve tiempos por palabra. */
  wordTimings: boolean;
  /**
   * Aviso que la interfaz DEBE mostrar antes de usarlo. §6.4 exige decir que
   * el dictado del navegador manda el audio a Google.
   */
  privacyNote?: string;
  transcribe(req: AsrRequest, cfg: AsrCredentials): Promise<AsrResult>;
}

export class AsrError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

/**
 * Modelos locales ofrecidos. `mb` es el peso de la variante cuantizada, que
 * es la que se intenta primero; si esa no arranca en el navegador se cae a
 * fp32, que ocupa del orden de tres veces más. Por eso se anuncia un rango.
 */
export const WHISPER_MODELS = [
  {
    id: "Xenova/whisper-tiny.en",
    label: "Whisper tiny · solo inglés · export clásico",
    mb: 42,
    mbFull: 150,
    englishOnly: true,
  },
  {
    id: "Xenova/whisper-tiny",
    label: "Whisper tiny · multilingüe · export clásico",
    mb: 45,
    mbFull: 155,
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-tiny",
    label: "Whisper tiny · multilingüe · export nuevo",
    mb: 45,
    mbFull: 155,
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-base",
    label: "Whisper base · más preciso, más pesado",
    mb: 82,
    mbFull: 290,
    englishOnly: false,
  },
] as const;

/**
 * Por defecto el export clásico de Xenova: es el más probado en navegador.
 * Los de onnx-community traen nodos QDQ que algunas versiones de onnxruntime
 * no saben optimizar y hacen fallar la creación de la sesión.
 */
export const DEFAULT_WHISPER = "Xenova/whisper-tiny";

export function whisperModelInfo(id: string) {
  return WHISPER_MODELS.find((m) => m.id === id);
}
