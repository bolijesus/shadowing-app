"use client";

import type { Capability, ProviderConfig } from "@/lib/crypto/keystore";

export interface ProviderMeta {
  id: string;
  label: string;
  capabilities: Capability[];
  /** No requiere API key (funciona sin configurar nada). */
  keyless?: boolean;
  models: string[];
  keyHint?: string;
  docsNote: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "browser",
    label: "Voz / dictado del navegador",
    capabilities: ["tts", "asr"],
    keyless: true,
    models: [],
    docsNote:
      "TTS: speechSynthesis, gratis y offline. ASR: SpeechRecognition (solo Chrome; envía audio a Google).",
  },
  {
    id: "whisper-local",
    label: "Whisper local (en el dispositivo)",
    capabilities: ["asr"],
    keyless: true,
    models: ["Xenova/whisper-tiny", "Xenova/whisper-base"],
    docsNote:
      "Se descarga una vez (~40–150 MB) y funciona offline. Se activa en la fase de IA.",
  },
  {
    id: "openai",
    label: "OpenAI",
    capabilities: ["tts", "asr", "llm"],
    models: [
      "gpt-4o-mini-tts",
      "tts-1",
      "tts-1-hd",
      "whisper-1",
      "gpt-4o-transcribe",
      "gpt-4o-mini",
      "gpt-4o",
    ],
    keyHint: "sk-…",
    docsNote:
      "La key viaja desde el navegador. Restríngela por dominio y usa una con cuota baja dedicada a esta app.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    capabilities: ["tts", "asr", "llm"],
    models: [
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-pro-preview-tts",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ],
    keyHint: "AIza…",
    docsNote:
      "Voces con estilo en lenguaje natural (Iapetus, Sulafat, Kore, Puck…). Restringe la key por referente.",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    capabilities: ["tts"],
    models: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
    keyHint: "xi-api-key",
    docsNote: "Restringe la key y vigila el consumo de caracteres.",
  },
  {
    id: "deepgram",
    label: "Deepgram",
    capabilities: ["asr"],
    models: ["nova-2", "nova-3"],
    keyHint: "Token …",
    docsNote: "Transcripción con timestamps por palabra.",
  },
];

export function providersFor(cap: Capability): ProviderMeta[] {
  return PROVIDERS.filter((p) => p.capabilities.includes(cap));
}

export function getProvider(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface TestResult {
  ok: boolean;
  detail: string;
}

/** "Probar conexión" (§11). Prioriza el proxy propio si está configurado. */
export async function testConnection(
  id: string,
  cfg: ProviderConfig,
): Promise<TestResult> {
  const meta = getProvider(id);
  if (!meta) return { ok: false, detail: "Proveedor desconocido." };
  if (meta.keyless) {
    return {
      ok: true,
      detail:
        id === "browser"
          ? `${(typeof window !== "undefined" && "speechSynthesis" in window) ? "Síntesis de voz disponible" : "Sin síntesis de voz"}.`
          : "No requiere conexión.",
    };
  }

  try {
    if (cfg.proxyUrl) {
      const r = await fetch(cfg.proxyUrl, { method: "GET" });
      return {
        ok: r.ok,
        detail: r.ok ? "Proxy accesible." : `Proxy respondió ${r.status}.`,
      };
    }
    if (!cfg.apiKey) return { ok: false, detail: "Falta la API key." };

    let url = "";
    let headers: Record<string, string> = {};
    if (id === "openai") {
      url = "https://api.openai.com/v1/models";
      headers = { Authorization: `Bearer ${cfg.apiKey}` };
    } else if (id === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`;
    } else if (id === "elevenlabs") {
      url = "https://api.elevenlabs.io/v1/user";
      headers = { "xi-api-key": cfg.apiKey };
    } else if (id === "deepgram") {
      url = "https://api.deepgram.com/v1/projects";
      headers = { Authorization: `Token ${cfg.apiKey}` };
    } else {
      return { ok: false, detail: "Prueba no implementada para este proveedor." };
    }

    const res = await fetch(url, { headers });
    if (res.ok) return { ok: true, detail: "Conexión correcta." };
    if (res.status === 401 || res.status === 403)
      return { ok: false, detail: "La API key no es válida." };
    return { ok: false, detail: `El servidor respondió ${res.status}.` };
  } catch {
    return {
      ok: false,
      detail:
        "No se pudo verificar desde el navegador (posible CORS). La key se ha guardado igualmente.",
    };
  }
}
