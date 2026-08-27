/** Contrato común de los proveedores de voz (§4.3). */

export type TtsProviderId = "browser" | "gemini" | "openai" | "elevenlabs";

export interface TtsVoice {
  id: string;
  label: string;
}

/** Entrega / estilo, como en las capturas de referencia. */
export interface DeliveryStyle {
  id: string;
  label: string;
  /** Instrucción en lenguaje natural para los motores que la admiten. */
  instruction: string;
  /** Ajuste de velocidad sugerido. */
  rate: number;
}

export const DELIVERY_STYLES: DeliveryStyle[] = [
  {
    id: "clear",
    label: "Claro · Cómodo",
    instruction: "Read this clearly and calmly, at a comfortable pace.",
    rate: 1,
  },
  {
    id: "warm",
    label: "Cálido · Conversacional",
    instruction: "Read this warmly, like a relaxed conversation with a friend.",
    rate: 1,
  },
  {
    id: "firm",
    label: "Firme · Directo",
    instruction: "Read this firmly and directly, with confident emphasis.",
    rate: 1,
  },
  {
    id: "fast",
    label: "Rápido · Casual",
    instruction: "Read this quickly and casually, like everyday speech.",
    rate: 1.15,
  },
];

export function styleById(id: string): DeliveryStyle {
  return DELIVERY_STYLES.find((s) => s.id === id) ?? DELIVERY_STYLES[0]!;
}

export interface TtsRequest {
  provider: TtsProviderId;
  voice: string;
  style: string;
  rate: number;
  text: string;
  language: string;
}

export interface TtsAudio {
  bytes: ArrayBuffer;
  mime: string;
}

/**
 * Un proveedor que devuelve bytes permite guardar el audio del modelo en
 * OPFS y, con ello, forma de onda, curva de entonación y nota acústica.
 * `speechSynthesis` del navegador solo puede *hablar*: no expone el audio,
 * así que su voz es efímera y no da análisis (se avisa en la UI).
 */
export interface TtsProvider {
  id: TtsProviderId;
  label: string;
  /** false = solo reproduce, no devuelve bytes. */
  producesAudio: boolean;
  needsApiKey: boolean;
  voices(language?: string): Promise<TtsVoice[]> | TtsVoice[];
  synth?(req: TtsRequest, cfg: ProviderCredentials): Promise<TtsAudio>;
  speak?(req: TtsRequest): Promise<void>;
}

export interface ProviderCredentials {
  apiKey?: string;
  model?: string;
  proxyUrl?: string;
}

export class TtsError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}
