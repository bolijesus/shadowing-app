"use client";

import {
  AsrError,
  type AsrCredentials,
  type AsrEngine,
  type AsrRequest,
  type AsrResult,
  type AsrWord,
} from "./types";

/* ------------------------------- OpenAI -------------------------------- */

const openai: AsrEngine = {
  id: "openai",
  label: "OpenAI Whisper",
  needsApiKey: true,
  offline: false,
  wordTimings: true,
  async transcribe(req, cfg) {
    const url = cfg.proxyUrl
      ? `${cfg.proxyUrl.replace(/\/$/, "")}/openai/audio/transcriptions`
      : "https://api.openai.com/v1/audio/transcriptions";

    const form = new FormData();
    form.append("file", req.audio, "take.webm");
    form.append("model", asrModelOr(cfg.model, "whisper-1"));
    form.append("language", req.language.split("-")[0]!);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const headers: Record<string, string> = {};
    if (!cfg.proxyUrl) {
      if (!cfg.apiKey) throw new AsrError("Falta la API key de OpenAI.");
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetch(url, { method: "POST", headers, body: form });
    if (!res.ok) throw httpError("OpenAI", res.status, await safeText(res));

    const json = await res.json();
    const words: AsrWord[] | undefined = Array.isArray(json.words)
      ? json.words.map((w: { word: string; start: number; end: number }) => ({
          text: w.word,
          start: w.start,
          end: w.end,
        }))
      : undefined;
    return { text: (json.text ?? "").trim(), words, engine: "openai" };
  },
};

/* ------------------------------- Gemini -------------------------------- */

const gemini: AsrEngine = {
  id: "gemini",
  label: "Google Gemini",
  needsApiKey: true,
  offline: false,
  // Transcribe bien, pero no da offsets fiables por palabra.
  wordTimings: false,
  async transcribe(req, cfg) {
    const model = asrModelOr(cfg.model, "gemini-2.5-flash");
    const url = cfg.proxyUrl
      ? `${cfg.proxyUrl.replace(/\/$/, "")}/gemini/${model}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!cfg.proxyUrl) {
      if (!cfg.apiKey) throw new AsrError("Falta la API key de Gemini.");
      headers["x-goog-api-key"] = cfg.apiKey;
    }

    const b64 = await blobToBase64(req.audio);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Transcribe this audio in ${req.language}. Reply with the transcription only, no commentary.`,
              },
              {
                inlineData: {
                  mimeType: req.audio.type || "audio/webm",
                  data: b64,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw httpError("Gemini", res.status, await safeText(res));

    const json = await res.json();
    const text: string =
      json?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join(" ")
        .trim() ?? "";
    if (!text) throw new AsrError("Gemini no devolvió transcripción.");
    return { text, engine: "gemini" };
  },
};

/* ------------------------------- Deepgram ------------------------------- */

const deepgram: AsrEngine = {
  id: "deepgram",
  label: "Deepgram",
  needsApiKey: true,
  offline: false,
  wordTimings: true,
  async transcribe(req, cfg) {
    const model = asrModelOr(cfg.model, "nova-2");
    const lang = req.language.split("-")[0]!;
    const qs = `?model=${model}&language=${lang}&punctuate=true`;
    const url = cfg.proxyUrl
      ? `${cfg.proxyUrl.replace(/\/$/, "")}/deepgram/listen${qs}`
      : `https://api.deepgram.com/v1/listen${qs}`;

    const headers: Record<string, string> = {
      "Content-Type": req.audio.type || "audio/webm",
    };
    if (!cfg.proxyUrl) {
      if (!cfg.apiKey) throw new AsrError("Falta la API key de Deepgram.");
      headers.Authorization = `Token ${cfg.apiKey}`;
    }

    const res = await fetch(url, { method: "POST", headers, body: req.audio });
    if (!res.ok) throw httpError("Deepgram", res.status, await safeText(res));

    const json = await res.json();
    const alt = json?.results?.channels?.[0]?.alternatives?.[0];
    const words: AsrWord[] | undefined = Array.isArray(alt?.words)
      ? alt.words.map(
          (w: { word: string; punctuated_word?: string; start: number; end: number }) => ({
            text: w.punctuated_word ?? w.word,
            start: w.start,
            end: w.end,
          }),
        )
      : undefined;
    return { text: (alt?.transcript ?? "").trim(), words, engine: "deepgram" };
  },
};

/* ---------------------------- navegador (§6.4) --------------------------- */

/**
 * `SpeechRecognition` solo escucha del micrófono en vivo: no acepta un blob.
 * Por eso no sirve para puntuar una toma ya grabada, y se deja para responder
 * en voz alta en los juegos. Y manda el audio a Google, cosa que hay que
 * decir siempre (§6.4).
 */
const browser: AsrEngine = {
  id: "browser",
  label: "Dictado del navegador",
  needsApiKey: false,
  offline: false,
  wordTimings: false,
  privacyNote:
    "Envía tu voz a los servidores de Google para reconocerla. Solo funciona en Chrome y escuchando en directo, no sobre una grabación ya hecha.",
  async transcribe() {
    throw new AsrError(
      "El dictado del navegador no puede transcribir una grabación: solo escucha en directo. Elige Whisper local o un proveedor con API.",
    );
  },
};

/** Escucha en vivo, que es lo único que este motor sabe hacer. */
export function browserSpeechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function listenOnce(
  language: string,
  onResult: (text: string, final: boolean) => void,
): () => void {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
  if (!Ctor) throw new AsrError("Este navegador no tiene dictado.");

  const rec = new Ctor();
  rec.lang = language;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    if (r) onResult(r[0]?.transcript ?? "", r.isFinal);
  };
  rec.start();
  return () => {
    try {
      rec.stop();
    } catch {
      /* ya parado */
    }
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        results: { isFinal: boolean; [i: number]: { transcript: string } }[];
      }) => void)
    | null;
  start(): void;
  stop(): void;
}

/* ------------------------------- registro ------------------------------- */

const REGISTRY: Record<string, AsrEngine> = {
  openai,
  gemini,
  deepgram,
  browser,
};

export function apiEngine(id: string): AsrEngine | undefined {
  return REGISTRY[id];
}

/** Acepta el modelo configurado solo si es de transcripción. */
function asrModelOr(model: string | undefined, fallback: string): string {
  return model && /whisper|transcribe|nova|flash|pro/i.test(model)
    ? model
    : fallback;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function httpError(who: string, status: number, detail: string): AsrError {
  if (status === 401 || status === 403)
    return new AsrError(`${who}: la API key no es válida.`);
  if (status === 429)
    return new AsrError(`${who}: límite de peticiones alcanzado.`, true);
  if (status >= 500)
    return new AsrError(`${who}: error del servidor (${status}).`, true);
  return new AsrError(`${who}: ${status}. ${detail.slice(0, 160)}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export type { AsrEngine, AsrRequest, AsrResult, AsrCredentials };
