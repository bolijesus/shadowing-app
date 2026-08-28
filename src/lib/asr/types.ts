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

/** Modelos locales ofrecidos, con su peso para poder avisar antes (§2). */
export const WHISPER_MODELS = [
  {
    id: "onnx-community/whisper-tiny.en",
    label: "Whisper tiny · solo inglés",
    mb: 42,
    englishOnly: true,
  },
  {
    id: "onnx-community/whisper-tiny",
    label: "Whisper tiny · multilingüe",
    mb: 45,
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-base",
    label: "Whisper base · multilingüe, más preciso",
    mb: 82,
    englishOnly: false,
  },
] as const;

export const DEFAULT_WHISPER = "onnx-community/whisper-tiny";

export function whisperModelInfo(id: string) {
  return WHISPER_MODELS.find((m) => m.id === id);
}
