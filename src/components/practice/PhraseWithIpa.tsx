"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  ipaForWords,
  splitWords,
  engineSizeMb,
  ipaAvailable,
  type WordIpa,
} from "@/lib/ipa";
import {
  distributeWords,
  distributeWordsOverSpeech,
  fillAt,
  type WordSpan,
} from "@/lib/text/wordTiming";

/**
 * Casa las palabras del texto con las que devolvió el ASR.
 *
 * No se pueden emparejar por índice a secas: el reconocedor puede partir o
 * juntar palabras, o colarse alguna. Se avanza en paralelo comparando formas
 * normalizadas, y si el desajuste es grande se renuncia y se usa el reparto
 * aproximado, que es más honesto que un karaoke desalineado.
 */
function alignTimings(
  words: string[],
  timings: { text: string; start: number; end: number }[],
): WordSpan[] | null {
  const norm = (w: string) =>
    w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

  const out: WordSpan[] = [];
  let t = 0;
  let matched = 0;

  for (let i = 0; i < words.length; i++) {
    const want = norm(words[i]!);
    let found = -1;
    // Se busca en una ventana corta para tolerar inserciones del ASR.
    for (let k = t; k < Math.min(timings.length, t + 3); k++) {
      if (norm(timings[k]!.text) === want && want) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      out.push({
        index: i,
        startSec: timings[found]!.start,
        endSec: timings[found]!.end,
      });
      t = found + 1;
      matched++;
    } else {
      // Sin correspondencia: se rellena entre la anterior y la siguiente.
      const prev = out[out.length - 1];
      const start = prev ? prev.endSec : (timings[t]?.start ?? 0);
      out.push({ index: i, startSec: start, endSec: start });
    }
  }

  // Con menos de dos tercios emparejados no es fiable.
  return matched / words.length >= 0.66 ? out : null;
}

/** Abreviaturas que acaban en punto sin cerrar frase. */
const ABBREV = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "vs.", "etc.", "jr.", "sr.",
  "sra.", "srta.", "dra.", "ud.", "uds.", "ej.", "aprox.", "núm.", "pág.",
]);

/** ¿Esta palabra cierra una frase de verdad? */
function endsSentence(word: string): boolean {
  if (!/[.!?…。！？]["'»)\]]*$/.test(word)) return false;
  const bare = word.toLowerCase().replace(/["'»)\]]+$/, "");
  if (ABBREV.has(bare)) return false;
  // Iniciales tipo «J.» o «A.»: tampoco cierran.
  if (/^\p{L}\.$/u.test(bare)) return false;
  return true;
}

/**
 * Frase objetivo con el IPA bajo cada palabra (§6.5, §12).
 * Al tocar una palabra se abre un popover con su transcripción, útil en
 * móvil donde el texto pequeño no se lee bien.
 */
export function PhraseWithIpa({
  text,
  language,
  showIpa,
  className,
  karaoke = false,
  progressSec = 0,
  durationSec = 0,
  energy,
  energyHopSec,
  wordTimings,
}: {
  text: string;
  language: string;
  showIpa: boolean;
  className?: string;
  /** Resaltado tipo karaoke siguiendo la reproducción. */
  karaoke?: boolean;
  progressSec?: number;
  durationSec?: number;
  /** Envolvente del modelo: alinea las palabras con la voz, no con el reloj. */
  energy?: Float32Array | null;
  energyHopSec?: number;
  /**
   * Tiempos reales por palabra, si el motor de ASR los ha dado. Tienen
   * prioridad sobre cualquier reparto: son medidos, no estimados (§6.4).
   */
  wordTimings?: { text: string; start: number; end: number }[] | null;
}) {
  const words = React.useMemo(() => splitWords(text), [text]);
  const [entries, setEntries] = React.useState<WordIpa[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState<number | null>(null);

  const available = ipaAvailable(language);

  React.useEffect(() => {
    if (!showIpa || !words.length || !available) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    ipaForWords(words, language)
      .then((res) => {
        if (cancelled) return;
        setEntries(res);
        setFailed(res.every((e) => !e.ipa));
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [showIpa, words, language, available]);

  /**
   * Agrupa las palabras en frases para poder pintarlas en líneas separadas.
   * Se conserva el índice global de cada palabra, que es el que usan el
   * karaoke y el IPA: una ronda de tres frases seguidas es un muro de texto.
   */
  const lines = React.useMemo<{ word: string; index: number }[][]>(() => {
    const out: { word: string; index: number }[][] = [];
    let current: { word: string; index: number }[] = [];
    words.forEach((word, index) => {
      current.push({ word, index });
      if (endsSentence(word)) {
        out.push(current);
        current = [];
      }
    });
    if (current.length) out.push(current);
    return out.length ? out : [words.map((word, index) => ({ word, index }))];
  }, [words]);

  const spans = React.useMemo<WordSpan[]>(() => {
    if (!karaoke || !words.length || durationSec <= 0) return [];

    // 1. Tiempos medidos por el ASR: lo mejor que se puede tener.
    if (wordTimings && wordTimings.length) {
      const aligned = alignTimings(words, wordTimings);
      if (aligned) return aligned;
    }
    // 2. Reparto sobre los tramos con voz: alinea arranque y pausas.
    if (energy && energy.length && energyHopSec) {
      return distributeWordsOverSpeech(words, durationSec, energy, energyHopSec);
    }
    // 3. Reparto proporcional a secas (§6.4).
    return distributeWords(words, durationSec);
  }, [karaoke, words, durationSec, energy, energyHopSec, wordTimings]);

  React.useEffect(() => {
    if (open === null) return;
    const close = () => setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!text) {
    return (
      <p className={cn("text-ink-soft", className)}>
        (sin texto para esta ronda)
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-2">
        {lines.map((line, li) => (
          <p
            key={li}
            className="flex flex-wrap items-end gap-x-2 gap-y-1 text-[22px] font-extrabold leading-snug text-ink"
          >
            {line.map(({ word: w, index: i }) => {
              const ipa = entries?.[i]?.ipa ?? "";
              const span = spans[i];
              const fill = karaoke && span ? fillAt(span, progressSec) : 0;
              return (
                <span key={`${w}-${i}`} className="relative inline-block">
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      if (!ipa) return;
                      e.stopPropagation();
                      setOpen(open === i ? null : i);
                    }}
                    className={cn(
                      "relative text-left",
                      ipa &&
                        "cursor-help underline decoration-dotted decoration-line-strong underline-offset-4",
                    )}
                    aria-label={ipa ? `${w}, se pronuncia ${ipa}` : w}
                  >
                    {w}
                    {/* Karaoke: lo ya dicho se pinta encima en rojo. El texto
                        que falta se queda en su color normal, no atenuado: si
                        no, una ronda sin reproducir parece desactivada. */}
                    {karaoke && fill > 0 && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden whitespace-pre text-brand-ink"
                        style={{ width: `${fill * 100}%` }}
                      >
                        {w}
                      </span>
                    )}
                  </button>

                  {showIpa && ipa && (
                    <span className="mt-0.5 block text-center font-mono text-[13px] font-medium text-ink-soft">
                      /{ipa}/
                    </span>
                  )}

                  {open === i && ipa && (
                    <span
                      role="tooltip"
                      className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-line bg-surface px-3 py-1.5 font-mono text-sm font-medium text-ink shadow-sm"
                    >
                      /{ipa}/
                    </span>
                  )}
                </span>
              );
            })}
          </p>
        ))}
      </div>

      {showIpa && !available && (
        <p className="mt-2 text-xs text-ink-soft">
          Todavía no hay transcripción fonética para este idioma. El motor
          multilingüe que usa la app cubre lenguas de alfabeto latino.
        </p>
      )}

      {showIpa && loading && (
        <p className="mt-2 text-xs text-ink-soft">
          Preparando la transcripción fonética… la primera vez se descarga el
          diccionario ({engineSizeMb(language).toFixed(1)} MB) y luego queda
          guardado.
        </p>
      )}

      {showIpa && failed && !loading && available && (
        <p className="mt-2 text-xs text-ink-soft">
          No se pudo generar el IPA. Comprueba que el idioma del medio es
          correcto o vuelve a intentarlo.
        </p>
      )}
    </div>
  );
}
