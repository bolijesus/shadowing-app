/// <reference lib="webworker" />
import * as Comlink from "comlink";

/**
 * espeak-ng compilado a WASM (§6.5). Vive en un worker porque el módulo
 * pesa ~18 MB y arrancarlo bloquearía la interfaz. Se importa de forma
 * perezosa: no entra en el bundle hasta que se pide el primer IPA.
 */

type EspeakFactory = (opts: {
  arguments: string[];
}) => Promise<{ FS: { readFile(p: string, o: { encoding: "utf8" }): string } }>;

let factory: EspeakFactory | null = null;

/**
 * El módulo de Emscripten localiza su .wasm con `new URL('./', import.meta.url)`,
 * que webpack no sabe resolver ("Can't resolve './'"). Por eso vive
 * auto-hospedado en /public/espeak y se carga en tiempo de ejecución con
 * webpackIgnore, en lugar de intentar empaquetarlo.
 */
async function getFactory(): Promise<EspeakFactory> {
  if (!factory) {
    const url = new URL("/espeak/espeak-ng.js", self.location.origin).href;
    const mod = await import(/* webpackIgnore: true */ url);
    factory = (mod.default ?? mod) as EspeakFactory;
  }
  return factory;
}

/**
 * BCP-47 al código de voz de espeak-ng.
 *
 * Solo idiomas de alfabeto latino: este build está recortado y con japonés,
 * coreano, chino o ruso no transcribe, sino que deletrea el nombre de cada
 * carácter en inglés. Antes que devolver eso, se devuelve vacío y la interfaz
 * dice que no hay IPA para ese idioma (§16: no inventar transcripciones).
 */
const VOICES: Record<string, string> = {
  "en-us": "en-us",
  "en-gb": "en-gb",
  en: "en-us",
  "es-es": "es",
  "es-419": "es-la",
  "es-mx": "es-la",
  es: "es",
  "fr-fr": "fr",
  fr: "fr",
  "de-de": "de",
  de: "de",
  "it-it": "it",
  it: "it",
  "pt-br": "pt-br",
  "pt-pt": "pt",
  pt: "pt",
  "nl-nl": "nl",
  nl: "nl",
  "pl-pl": "pl",
  pl: "pl",
  ca: "ca",
  "ca-es": "ca",
  sv: "sv",
  da: "da",
  nb: "nb",
  fi: "fi",
  tr: "tr",
  ro: "ro",
  cs: "cs",
};

function voiceFor(language: string): string | null {
  const lang = language.toLowerCase();
  if (VOICES[lang]) return VOICES[lang]!;
  const base = lang.split("-")[0]!;
  return VOICES[base] ?? null;
}

const api = {
  /** Transcribe un texto entero. Devuelve IPA con marcadores de acento. */
  /** Idiomas que este build transcribe de verdad. */
  supports(language: string): boolean {
    return voiceFor(language) !== null;
  },

  async phonemize(text: string, language: string): Promise<string> {
    if (!text.trim()) return "";
    const voice = voiceFor(language);
    if (!voice) return "";
    const ESpeakNg = await getFactory();
    const mod = await ESpeakNg({
      arguments: [
        "--phonout",
        "generated",
        "--sep=",
        "-q",
        "-b=1",
        "--ipa=3",
        "-v",
        voice,
        text,
      ],
    });
    return mod.FS.readFile("generated", { encoding: "utf8" }).trim();
  },

  /** Transcribe palabra a palabra, para poder alinearlas con el texto. */
  async phonemizeWords(
    words: string[],
    language: string,
  ): Promise<string[]> {
    if (!voiceFor(language)) return words.map(() => "");
    const out: string[] = [];
    for (const w of words) {
      try {
        out.push(await api.phonemize(w, language));
      } catch {
        out.push("");
      }
    }
    return out;
  },
};

export type IpaWorkerApi = typeof api;
Comlink.expose(api);
