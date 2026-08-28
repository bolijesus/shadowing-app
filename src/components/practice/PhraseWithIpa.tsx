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
}: {
  text: string;
  language: string;
  showIpa: boolean;
  className?: string;
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
      <p className="flex flex-wrap items-end gap-x-2 gap-y-1 text-[22px] font-extrabold leading-snug text-ink">
        {words.map((w, i) => {
          const ipa = entries?.[i]?.ipa ?? "";
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
                  "text-left",
                  ipa && "cursor-help underline decoration-dotted decoration-line-strong underline-offset-4",
                )}
                aria-label={ipa ? `${w}, se pronuncia ${ipa}` : w}
              >
                {w}
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
