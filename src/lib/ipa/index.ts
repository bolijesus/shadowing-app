"use client";

import * as Comlink from "comlink";
import { db } from "@/lib/db/db";
import type { IpaWorkerApi } from "@/workers/ipa.worker";
import { lookupCmudict, normalizeWord, CMUDICT_MB } from "./cmudict";

/**
 * IPA por palabra (§6.5).
 *
 * Orden: para inglés manda cmudict, que es un diccionario real y trae el
 * acento; si la palabra no está, cae en espeak-ng. Para el resto de idiomas
 * va directo a espeak-ng. Nunca se inventa con un LLM (§16).
 *
 * Todo se cachea por {idioma, palabra} en IndexedDB, así que la segunda vez
 * ni siquiera se toca el motor.
 */

export const ESPEAK_MB = 18.5;
export { CMUDICT_MB };

let proxy: Comlink.Remote<IpaWorkerApi> | null = null;
let worker: Worker | null = null;

function ipaWorker(): Comlink.Remote<IpaWorkerApi> {
  if (!proxy) {
    worker = new Worker(new URL("../../workers/ipa.worker.ts", import.meta.url), {
      type: "module",
      name: "ipa",
    });
    proxy = Comlink.wrap<IpaWorkerApi>(worker);
  }
  return proxy;
}

export function isEnglish(language: string): boolean {
  return language.toLowerCase().startsWith("en");
}

/**
 * Idiomas con IPA disponible. El build de espeak-ng que se usa solo cubre
 * alfabeto latino: con japonés, coreano, chino o ruso deletrea el nombre de
 * cada carácter, así que se declaran no soportados en vez de mostrar eso.
 */
const SUPPORTED = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "pl",
  "ca", "sv", "da", "nb", "fi", "tr", "ro", "cs",
]);

export function ipaAvailable(language: string): boolean {
  return SUPPORTED.has(language.toLowerCase().split("-")[0]!);
}

/** Tamaño de descarga que se avisa antes de activar el IPA por primera vez. */
export function engineSizeMb(language: string): number {
  return isEnglish(language) ? CMUDICT_MB : ESPEAK_MB;
}

export interface WordIpa {
  word: string;
  ipa: string;
  stress?: number[];
  source: "cmudict" | "espeak" | "cache";
}

function cacheKey(lang: string, word: string): string {
  return `${lang.toLowerCase()} ${word}`;
}

async function fromCache(lang: string, word: string): Promise<WordIpa | null> {
  const row = await db().ipaCache.get(cacheKey(lang, word));
  if (!row) return null;
  return { word, ipa: row.ipa, stress: row.stress, source: "cache" };
}

async function toCache(lang: string, entry: WordIpa): Promise<void> {
  const key = normalizeWord(entry.word);
  if (!key || !entry.ipa) return;
  await db().ipaCache.put({
    key: cacheKey(lang, key),
    lang: lang.toLowerCase(),
    word: key,
    ipa: entry.ipa,
    stress: entry.stress,
  });
}

/** Transcribe una lista de palabras. Devuelve una entrada por palabra. */
export async function ipaForWords(
  words: string[],
  language: string,
): Promise<WordIpa[]> {
  if (!ipaAvailable(language)) {
    return words.map((w) => ({ word: w, ipa: "", source: "espeak" as const }));
  }
  const keys = words.map(normalizeWord);
  const out: (WordIpa | null)[] = new Array(words.length).fill(null);

  // 1. Caché.
  await Promise.all(
    keys.map(async (k, i) => {
      if (!k) {
        out[i] = { word: words[i]!, ipa: "", source: "cache" };
        return;
      }
      out[i] = await fromCache(language, k);
    }),
  );

  // 2. cmudict, solo para inglés.
  if (isEnglish(language)) {
    for (let i = 0; i < words.length; i++) {
      if (out[i] || !keys[i]) continue;
      const hit = await lookupCmudict(words[i]!);
      if (hit) {
        const entry: WordIpa = {
          word: words[i]!,
          ipa: hit.ipa,
          stress: hit.stress,
          source: "cmudict",
        };
        out[i] = entry;
        await toCache(language, entry);
      }
    }
  }

  // 3. espeak-ng para lo que quede (otros idiomas, o palabras fuera del
  //    diccionario: nombres propios, invenciones, argot).
  const pending = words
    .map((w, i) => ({ w, i }))
    .filter(({ i }) => !out[i] && keys[i]);

  if (pending.length) {
    try {
      const res = await ipaWorker().phonemizeWords(
        pending.map((p) => p.w),
        language,
      );
      for (let k = 0; k < pending.length; k++) {
        const entry: WordIpa = {
          word: pending[k]!.w,
          ipa: (res[k] ?? "").trim(),
          source: "espeak",
        };
        out[pending[k]!.i] = entry;
        await toCache(language, entry);
      }
    } catch {
      // El motor no arrancó: se deja vacío en vez de inventar nada.
      for (const { i, w } of pending) {
        out[i] = { word: w, ipa: "", source: "espeak" };
      }
    }
  }

  return out.map((e, i) => e ?? { word: words[i]!, ipa: "", source: "cache" });
}

/** Divide una frase en palabras conservando la puntuación aparte. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export async function clearIpaCache(): Promise<number> {
  const n = await db().ipaCache.count();
  await db().ipaCache.clear();
  return n;
}

export function releaseIpaWorker(): void {
  worker?.terminate();
  worker = null;
  proxy = null;
}
