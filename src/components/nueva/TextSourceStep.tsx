"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Eyebrow,
  Field,
  Pill,
  SelectField,
  TextInput,
} from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { VoicePicker, DEFAULT_VOICE, type VoiceSelection } from "./VoicePicker";
import { splitScript, estimateSpokenSec } from "@/lib/text/splitScript";
import { createPracticeFromText } from "@/lib/media/createFromText";
import { ttsProvider } from "@/lib/tts/providers";
import type { ShowText } from "@/lib/types";
import { fmtClock } from "@/lib/util";

const EXAMPLE = `Could you send me the final report?
I wanted to check whether Thursday afternoon still works for you.
The team has already completed the most urgent changes.`;

/**
 * Fuentes «Texto con voz IA» (§4.3) y «Pegar guion» (§4.4).
 * Son el mismo flujo: texto → frases → voz. La diferencia es el énfasis:
 * en «guion» se pega y listo; en «voz IA» se elige voz y entrega primero.
 */
export function TextSourceStep({
  variant,
  language,
  onBack,
}: {
  variant: "tts" | "script";
  language: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [lang, setLang] = React.useState(language);
  const [script, setScript] = React.useState("");
  const [voice, setVoice] = React.useState<VoiceSelection>(DEFAULT_VOICE);
  const [showText, setShowText] = React.useState<ShowText>("fade");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const lines = React.useMemo(() => splitScript(script), [script]);
  const totalSec = lines.reduce(
    (s, l) => s + estimateSpokenSec(l.text, voice.rate) + 0.4,
    0,
  );
  const provider = ttsProvider(voice.provider);

  async function create() {
    setError(null);
    if (!lines.length) {
      setError("Escribe o pega al menos una frase.");
      return;
    }
    setBusy(true);
    try {
      const practice = await createPracticeFromText({
        title: title.trim() || lines[0]!.text.slice(0, 40),
        language: lang,
        script,
        showText,
        voice,
      });
      router.push(`/practica/${practice.id}/editar`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la práctica.");
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <Eyebrow>
          {variant === "tts" ? "Texto con voz IA" : "Pegar guion"}
        </Eyebrow>
        <h1 className="h-display mt-1 text-2xl">
          {variant === "tts"
            ? "Escribe lo que quieres practicar"
            : "Pega tu guion"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Cada línea o frase se convierte en una ronda. Las voces se preparan
          en el editor, y quedan guardadas para no repetir llamadas.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-sm font-medium text-ink">
          {error}
        </div>
      )}

      <Card className="space-y-4">
        <Field
          label="Texto"
          hint="Una frase por línea. También puedes usar «NOMBRE: frase» para diálogos."
        >
          <Textarea
            aria-label="Texto de la práctica"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={7}
            placeholder={EXAMPLE}
          />
        </Field>
        {!script && (
          <Button variant="outline" size="sm" onClick={() => setScript(EXAMPLE)}>
            Usar un ejemplo
          </Button>
        )}
      </Card>

      <Card className="space-y-4">
        <VoicePicker value={voice} onChange={setVoice} language={lang} />

        {!provider.producesAudio && (
          <p className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-sm text-ink">
            La voz del navegador solo puede <strong>hablar</strong>: no entrega
            el audio, así que esta práctica no tendrá forma de onda ni nota
            acústica del modelo. Para eso elige Gemini, OpenAI o ElevenLabs en
            Ajustes, o sube un archivo de audio.
          </p>
        )}
        {provider.needsApiKey && (
          <p className="text-xs text-ink-soft">
            Necesita una API key configurada en Ajustes → Proveedores de IA.
          </p>
        )}
      </Card>

      <Card className="grid gap-4 sm:grid-cols-3">
        <Field label="Título">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Confianza en el trabajo"
          />
        </Field>
        <Field label="Idioma">
          <SelectField
            aria-label="Idioma"
            value={lang}
            onValueChange={setLang}
            options={[
              ["en-US", "Inglés (EE. UU.)"],
              ["en-GB", "Inglés (Reino Unido)"],
              ["es-ES", "Español (España)"],
              ["fr-FR", "Francés"],
              ["de-DE", "Alemán"],
              ["it-IT", "Italiano"],
              ["pt-BR", "Portugués (Brasil)"],
              ["ja-JP", "Japonés"],
            ].map(([value, label]) => ({ value: value!, label: label! }))}
          />
        </Field>
        <Field label="Mostrar el texto">
          <SelectField
            aria-label="Mostrar el texto"
            value={showText}
            onValueChange={(v) => setShowText(v as ShowText)}
            options={[
              { value: "always", label: "Siempre" },
              { value: "fade", label: "Escalera (recomendado)" },
              { value: "never", label: "Nunca" },
            ]}
          />
        </Field>
      </Card>

      {lines.length > 0 && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-bold">
              {lines.length} {lines.length === 1 ? "ronda" : "rondas"}
            </p>
            <Pill>≈ {fmtClock(totalSec)}</Pill>
          </div>
          <ol className="space-y-1">
            {lines.slice(0, 8).map((l) => (
              <li
                key={l.index}
                className="rounded-lg bg-panel px-3 py-2 text-sm font-medium"
              >
                {l.speaker && (
                  <span className="mr-2 text-xs font-bold text-brand-ink">
                    {l.speaker}
                  </span>
                )}
                {l.text}
              </li>
            ))}
            {lines.length > 8 && (
              <li className="px-3 text-xs text-ink-soft">
                …y {lines.length - 8} más
              </li>
            )}
          </ol>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Volver
        </Button>
        <Button onClick={create} disabled={busy || !lines.length}>
          {busy ? "Creando…" : "Crear y preparar voces"}
        </Button>
      </div>
    </section>
  );
}
