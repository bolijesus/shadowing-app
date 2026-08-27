"use client";

import {
  base64ToArrayBuffer,
  pcm16ToWav,
  sampleRateFromMime,
} from "@/lib/audio/wav";
import {
  TtsError,
  type ProviderCredentials,
  type TtsAudio,
  type TtsProvider,
  type TtsProviderId,
  type TtsRequest,
  type TtsVoice,
} from "./types";
import {
  listBrowserVoices,
  speakWithBrowser,
  browserTtsSupported,
} from "./browser";

/* ------------------------------- navegador ------------------------------- */

const browser: TtsProvider = {
  id: "browser",
  label: "Voz del navegador",
  producesAudio: false, // speechSynthesis no expone el audio generado
  needsApiKey: false,
  voices(language) {
    const all = listBrowserVoices();
    const base = language ? language.split("-")[0]!.toLowerCase() : null;
    const list = base
      ? all.filter((v) => v.lang.toLowerCase().startsWith(base))
      : all;
    return (list.length ? list : all).map((v) => ({
      id: v.voiceURI,
      label: `${v.name} — ${v.lang}`,
    }));
  },
  async speak(req) {
    await speakWithBrowser(req.text, {
      voiceURI: req.voice || undefined,
      lang: req.language,
      rate: req.rate,
    });
  },
};

/* -------------------------------- Gemini -------------------------------- */

/** Voces prefabricadas de Gemini TTS (§4.3). Las primeras son las del prompt. */
const GEMINI_VOICES: TtsVoice[] = [
  ["Iapetus", "claro"],
  ["Sulafat", "cálido"],
  ["Kore", "firme"],
  ["Puck", "animado"],
  ["Charon", "informativo"],
  ["Fenrir", "enérgico"],
  ["Aoede", "suave"],
  ["Leda", "juvenil"],
  ["Zephyr", "luminoso"],
  ["Orus", "rotundo"],
  ["Callirrhoe", "relajado"],
  ["Autonoe", "brillante"],
  ["Enceladus", "susurrado"],
  ["Umbriel", "tranquilo"],
  ["Algieba", "grave"],
  ["Despina", "fluido"],
  ["Erinome", "nítido"],
  ["Algenib", "áspero"],
  ["Rasalgethi", "didáctico"],
  ["Laomedeia", "vivo"],
  ["Achernar", "delicado"],
  ["Alnilam", "seguro"],
  ["Schedar", "uniforme"],
  ["Gacrux", "maduro"],
  ["Pulcherrima", "expresivo"],
  ["Achird", "cercano"],
  ["Zubenelgenubi", "informal"],
  ["Vindemiatrix", "amable"],
  ["Sadachbia", "desenfadado"],
  ["Sadaltager", "culto"],
].map(([id, desc]) => ({ id: id!, label: `${id} · ${desc}` }));

const gemini: TtsProvider = {
  id: "gemini",
  label: "Gemini TTS",
  producesAudio: true,
  needsApiKey: true,
  voices: () => GEMINI_VOICES,
  async synth(req, cfg) {
    if (!req.voice) {
      throw new TtsError(
        "Elige una voz de Gemini antes de generar (Iapetus, Sulafat, Kore…).",
      );
    }
    // La configuración de la key es común al proveedor, pero el modelo no:
    // el de LLM (gemini-2.5-flash) no sirve para TTS. Si no es de voz, se
    // usa el de voz por defecto en lugar de fallar con un 400 críptico.
    const model = ttsModelOr(cfg.model, "gemini-2.5-flash-preview-tts");
    const body = {
      contents: [{ parts: [{ text: `${req.style}\n\n${req.text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } },
        },
      },
    };

    const url = cfg.proxyUrl
      ? `${cfg.proxyUrl.replace(/\/$/, "")}/gemini/${model}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!cfg.proxyUrl) {
      if (!cfg.apiKey) throw new TtsError("Falta la API key de Gemini.");
      headers["x-goog-api-key"] = cfg.apiKey;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw httpError("Gemini", res.status, await safeText(res));

    const json = await res.json();
    const part = json?.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data?: string } }) => p?.inlineData?.data,
    );
    const data: string | undefined = part?.inlineData?.data;
    if (!data) throw new TtsError("Gemini no devolvió audio.");

    const mime: string = part.inlineData.mimeType ?? "audio/L16;rate=24000";
    const raw = base64ToArrayBuffer(data);
    // Gemini entrega PCM crudo: hay que ponerle cabecera WAV.
    if (/l16|pcm/i.test(mime)) {
      return {
        bytes: pcm16ToWav(raw, sampleRateFromMime(mime)),
        mime: "audio/wav",
      };
    }
    return { bytes: raw, mime };
  },
};

/* -------------------------------- OpenAI -------------------------------- */

const OPENAI_VOICES: TtsVoice[] = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
].map((v) => ({ id: v, label: v }));

const openai: TtsProvider = {
  id: "openai",
  label: "OpenAI TTS",
  producesAudio: true,
  needsApiKey: true,
  voices: () => OPENAI_VOICES,
  async synth(req, cfg) {
    const url = cfg.proxyUrl
      ? `${cfg.proxyUrl.replace(/\/$/, "")}/openai/audio/speech`
      : "https://api.openai.com/v1/audio/speech";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!cfg.proxyUrl) {
      if (!cfg.apiKey) throw new TtsError("Falta la API key de OpenAI.");
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: ttsModelOr(cfg.model, "gpt-4o-mini-tts"),
        input: req.text,
        voice: req.voice || "alloy",
        instructions: req.style,
        response_format: "wav",
        speed: req.rate,
      }),
    });
    if (!res.ok) throw httpError("OpenAI", res.status, await safeText(res));
    return { bytes: await res.arrayBuffer(), mime: "audio/wav" };
  },
};

/* ------------------------------ ElevenLabs ------------------------------ */

const elevenlabs: TtsProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  producesAudio: true,
  needsApiKey: true,
  async voices() {
    return [];
  },
  async synth(req, cfg) {
    const voiceId = req.voice;
    if (!voiceId) throw new TtsError("Indica el ID de voz de ElevenLabs.");
    const url = cfg.proxyUrl
      ? `${cfg.proxyUrl.replace(/\/$/, "")}/elevenlabs/${voiceId}`
      : `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!cfg.proxyUrl) {
      if (!cfg.apiKey) throw new TtsError("Falta la API key de ElevenLabs.");
      headers["xi-api-key"] = cfg.apiKey;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: req.text,
        model_id: cfg.model || "eleven_multilingual_v2",
      }),
    });
    if (!res.ok) throw httpError("ElevenLabs", res.status, await safeText(res));
    return { bytes: await res.arrayBuffer(), mime: "audio/mpeg" };
  },
};

/* -------------------------------- registro ------------------------------- */

const REGISTRY: Record<TtsProviderId, TtsProvider> = {
  browser,
  gemini,
  openai,
  elevenlabs,
};

export function ttsProvider(id: TtsProviderId): TtsProvider {
  return REGISTRY[id] ?? browser;
}

export function ttsProviders(): TtsProvider[] {
  return Object.values(REGISTRY);
}

export function browserTtsAvailable(): boolean {
  return browserTtsSupported();
}

/** Sintetiza y devuelve bytes. Lanza si el proveedor no produce audio. */
export async function synthesize(
  req: TtsRequest,
  cfg: ProviderCredentials,
): Promise<TtsAudio> {
  const p = ttsProvider(req.provider);
  if (!p.producesAudio || !p.synth) {
    throw new TtsError(
      `${p.label} no puede entregar el audio, solo reproducirlo.`,
    );
  }
  return p.synth(req, cfg);
}

/** Acepta el modelo configurado solo si es de voz; si no, usa el de por defecto. */
function ttsModelOr(model: string | undefined, fallback: string): string {
  return model && /tts|speech|audio/i.test(model) ? model : fallback;
}

function httpError(who: string, status: number, detail: string): TtsError {
  if (status === 401 || status === 403) {
    return new TtsError(`${who}: la API key no es válida.`);
  }
  if (status === 429) {
    return new TtsError(`${who}: límite de peticiones alcanzado.`, true);
  }
  if (status >= 500) {
    return new TtsError(`${who}: error del servidor (${status}).`, true);
  }
  return new TtsError(`${who}: ${status}. ${detail.slice(0, 160)}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
