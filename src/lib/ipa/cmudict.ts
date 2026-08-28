"use client";

import { arpabetToIpa, type ArpaResult } from "./arpabet";

/**
 * cmudict para inglés (§6.5): más fiable que la predicción por reglas y
 * trae el acento marcado. Se carga de forma perezosa: son ~4,7 MB y no
 * pueden estar en el bundle inicial.
 */

export const CMUDICT_MB = 4.7;

let dictPromise: Promise<Record<string, string>> | null = null;

export function cmudictLoaded(): boolean {
  return dictPromise !== null;
}

export async function loadCmudict(): Promise<Record<string, string>> {
  if (!dictPromise) {
    dictPromise = import("cmu-pronouncing-dictionary").then(
      (m) => m.dictionary as Record<string, string>,
    );
  }
  return dictPromise;
}

/** Normaliza para buscar: cmudict está en minúsculas y sin puntuación. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, "")
    .replace(/^['-]+|['-]+$/g, "");
}

export async function lookupCmudict(
  word: string,
): Promise<ArpaResult | null> {
  const dict = await loadCmudict();
  const key = normalizeWord(word);
  if (!key) return null;

  const arpa = dict[key];
  if (arpa) return arpabetToIpa(arpa);

  // Plurales y formas verbales simples que cmudict no lista literalmente.
  for (const [suffix, stem] of [
    ["'s", ""],
    ["s", ""],
    ["es", ""],
    ["ed", ""],
    ["ing", ""],
  ] as const) {
    if (key.endsWith(suffix) && key.length > suffix.length + 1) {
      const base = key.slice(0, key.length - suffix.length) + stem;
      const alt = dict[base];
      if (alt) return arpabetToIpa(alt);
    }
  }
  return null;
}
