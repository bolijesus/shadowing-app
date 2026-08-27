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
import { RangeSelector } from "@/components/range/RangeSelector";
import {
  ACCEPT_ATTR,
  fsAccessSupported,
  importToOpfs,
  pickWithFsAccess,
} from "@/lib/media/source";
import { probeMedia } from "@/lib/media/probe";
import { parseSubtitles } from "@/lib/subtitles/parse";
import { segmentFromCues } from "@/lib/subtitles/segmentation";
import {
  createClip,
  createMedia,
  createPractice,
  createRounds,
  createTranscript,
} from "@/lib/db/repositories";
import type { Cue, Source } from "@/lib/types";
import { mediaFileCache } from "@/lib/media/fileCache";
import { fmtBytes, fmtClock, uid } from "@/lib/util";
import { TextSourceStep } from "@/components/nueva/TextSourceStep";
import { YouTubeStep } from "@/components/nueva/YouTubeStep";

type Step = "source" | "file" | "subs" | "range" | "rounds" | "youtube" | "tts" | "script";
type FileMode = "handle" | "session" | "opfs";

const LANGS = [
  ["en-US", "Inglés (EE. UU.)"],
  ["en-GB", "Inglés (Reino Unido)"],
  ["es-ES", "Español (España)"],
  ["fr-FR", "Francés"],
  ["de-DE", "Alemán"],
  ["it-IT", "Italiano"],
  ["pt-BR", "Portugués (Brasil)"],
  ["ja-JP", "Japonés"],
] as const;

export default function NuevaPracticaPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("source");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [file, setFile] = React.useState<File | null>(null);
  const [fileMode, setFileMode] = React.useState<FileMode>("session");
  const [handleId, setHandleId] = React.useState<string | undefined>();
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

  const [title, setTitle] = React.useState("");
  const [language, setLanguage] = React.useState<string>("en-US");
  const [duration, setDuration] = React.useState(0);
  const [hasVideo, setHasVideo] = React.useState(false);

  const [cues, setCues] = React.useState<Cue[]>([]);
  const [manualText, setManualText] = React.useState("");

  const [range, setRange] = React.useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [showText, setShowText] = React.useState<"always" | "fade" | "never">(
    "fade",
  );

  const previewRef = React.useRef<HTMLMediaElement | null>(null);

  const onFileChosen = React.useCallback(
    async (f: File, mode: FileMode, hId?: string) => {
      setError(null);
      setBusy("Leyendo el medio…");
      try {
        const probe = await probeMedia(f, f.name);
        setFile(f);
        setFileMode(mode);
        setHandleId(hId);
        setDuration(probe.durationSec);
        setHasVideo(probe.hasVideo);
        setTitle((t) => t || f.name.replace(/\.[^.]+$/, ""));
        setRange({ start: 0, end: Math.min(probe.durationSec, 40) || 0 });
        setStep("subs");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "No se pudo leer el archivo.",
        );
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  async function chooseWithFsAccess() {
    setError(null);
    try {
      const res = await pickWithFsAccess();
      if (res) await onFileChosen(res.file, "handle", res.handleId);
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") {
        setError("No se pudo abrir el selector de archivos.");
      }
    }
  }

  function onInputFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setPendingFile(f);
  }

  async function confirmPendingFile(mode: "session" | "opfs") {
    if (!pendingFile) return;
    const f = pendingFile;
    setPendingFile(null);
    await onFileChosen(f, mode);
  }

  async function onSubsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const parsed = parseSubtitles(f.name, text);
    if (!parsed.length) {
      setError(
        "No se reconocieron subtítulos en ese archivo. Prueba con .srt o .vtt, o escríbelos a mano.",
      );
      return;
    }
    setError(null);
    setCues(parsed);
    setRange({
      start: parsed[0]!.start,
      end: Math.min(duration || parsed[parsed.length - 1]!.end, parsed[0]!.start + 60),
    });
  }

  function applyManualText() {
    const lines = manualText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const span = (range.end - range.start || duration) / lines.length;
    const made: Cue[] = lines.map((text, i) => ({
      start: range.start + i * span,
      end: range.start + (i + 1) * span,
      text,
    }));
    setCues(made);
  }

  const seeds = React.useMemo(
    () =>
      cues.length
        ? segmentFromCues(cues, range.start, range.end)
        : [],
    [cues, range.start, range.end],
  );

  async function finish() {
    if (!file) return;
    setBusy("Creando la práctica…");
    setError(null);
    try {
      const mediaId = uid("m");
      let source: Source;
      if (fileMode === "opfs") {
        const { path } = await importToOpfs(file, file.name, mediaId);
        source = {
          kind: "opfs",
          path,
          mime: file.type || "application/octet-stream",
          sizeBytes: file.size,
        };
      } else {
        source = {
          kind: "local-file",
          handleId: fileMode === "handle" ? handleId : undefined,
          fileName: file.name,
          mime: file.type || "application/octet-stream",
          sizeBytes: file.size,
        };
      }

      const media = await createMedia({
        title: title || file.name,
        language,
        source,
        durationSec: duration,
        hasVideo,
      });

      if (cues.length) {
        await createTranscript(media.id, "file", cues);
      }

      const clip = await createClip(
        media.id,
        range.start,
        range.end,
        title || "Recorte",
      );

      const usableSeeds = seeds.length
        ? seeds
        : [
            {
              index: 0,
              startSec: range.start,
              endSec: range.end,
              text: manualText.trim(),
            },
          ];
      const rounds = await createRounds(clip.id, usableSeeds);

      const practice = await createPractice({
        title: title || "Práctica",
        clipId: clip.id,
        mode: "shadowing-echo",
        roundIds: rounds.map((r) => r.id),
        showText,
      });

      mediaFileCache.set(media.id, file);
      router.push(`/practica/${practice.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la práctica.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <ol
        className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs font-bold"
        hidden={step === "youtube" || step === "tts" || step === "script"}
      >
        {(["source", "file", "subs", "range", "rounds"] as Step[]).map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? "step" : undefined}
            className={
              step === s
                ? "text-brand-ink"
                : i < STEP_ORDER[step]
                  ? "text-ink"
                  : "text-ink-soft"
            }
          >
            {i + 1}. {STEP_LABEL[s]}
            {i < 4 && <span className="mx-1 text-line-strong">·</span>}
          </li>
        ))}
      </ol>

      {error && (
        <div className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-sm font-medium text-ink">
          {error}
        </div>
      )}
      {busy && (
        <div className="rounded-lg border-2 border-line bg-panel px-4 py-3 text-sm font-medium text-ink">
          {busy}
        </div>
      )}

      {step === "source" && (
        <section>
          <Eyebrow>Nueva práctica</Eyebrow>
          <h1 className="h-display mt-1 text-2xl">¿De dónde sale el contenido?</h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => setStep("file")}
              className="rounded-xl border-2 border-ink bg-surface p-5 text-left transition-colors hover:bg-panel"
            >
              <p className="h-display text-lg">Archivo del dispositivo</p>
              <p className="mt-1 text-sm text-ink-soft">
                Audio o vídeo local. El camino que mejor funciona: sin copiar
                bytes.
              </p>
              <p className="mt-2 text-xs font-bold text-brand-ink">
                Disponible ahora →
              </p>
            </button>
            {(
              [
                [
                  "youtube",
                  "YouTube",
                  "Reproducción por rangos y ejercicios de texto.",
                  "Sin onda del modelo",
                ],
                [
                  "tts",
                  "Texto con voz IA",
                  "Escribe las frases y genera las voces con TTS.",
                  null,
                ],
                [
                  "script",
                  "Pegar guion",
                  "Un guion se divide en frases automáticamente.",
                  null,
                ],
              ] as const
            ).map(([target, t, d, warn]) => (
              <button
                key={target}
                onClick={() => setStep(target as Step)}
                className="rounded-xl border-2 border-line bg-surface p-5 text-left transition-colors hover:border-ink hover:bg-panel"
              >
                <p className="h-display text-lg">{t}</p>
                <p className="mt-1 text-sm text-ink-soft">{d}</p>
                {warn ? (
                  <Pill className="mt-2">{warn}</Pill>
                ) : (
                  <p className="mt-2 text-xs font-bold text-brand-ink">
                    Disponible ahora →
                  </p>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "file" && (
        <section className="space-y-4">
          <Eyebrow>Paso 2 · Archivo</Eyebrow>
          <h1 className="h-display text-2xl">Elige el audio o el vídeo</h1>
          <p className="text-sm text-ink-soft">
            Formatos: mp3, m4a, wav, ogg, mp4, webm, mov.
          </p>

          {fsAccessSupported() ? (
            <div className="space-y-3">
              <Button className="w-full" variant="default" onClick={chooseWithFsAccess}>
                Seleccionar archivo
              </Button>
              <p className="text-xs text-ink-soft">
                Tu navegador recuerda el archivo para próximas sesiones sin
                copiarlo.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <input
                  type="file"
                  accept={ACCEPT_ATTR}
                  onChange={onInputFile}
                  className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-primary-foreground"
                />
              </label>
              {pendingFile && (
                <Card className="space-y-3">
                  <p className="text-sm">
                    <strong className="text-ink">{pendingFile.name}</strong> ·{" "}
                    {fmtBytes(pendingFile.size)}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      onClick={() => confirmPendingFile("session")}
                    >
                      Usar solo en esta sesión
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => confirmPendingFile("opfs")}
                    >
                      Importar a la app ({fmtBytes(pendingFile.size)})
                    </Button>
                  </div>
                  <p className="text-xs text-ink-soft">
                    &ldquo;Solo en esta sesión&rdquo; no ocupa espacio, pero
                    tendrás que volver a seleccionar el archivo la próxima vez.
                  </p>
                </Card>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={() => setStep("source")}>
            ← Volver
          </Button>
        </section>
      )}

      {step === "subs" && (
        <section className="space-y-4">
          <Eyebrow>Paso 3 · Subtítulos</Eyebrow>
          <h1 className="h-display text-2xl">Texto de referencia</h1>

          <Card className="space-y-3">
            <Field label="Subir archivo de subtítulos" hint=".srt, .vtt o .ass básico">
              <input
                type="file"
                accept=".srt,.vtt,.ass,.ssa,text/vtt"
                onChange={onSubsFile}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-primary-foreground"
              />
            </Field>
            {cues.length > 0 && (
              <p className="text-sm text-ok">
                {cues.length} líneas reconocidas.
              </p>
            )}
          </Card>

          <Card className="space-y-3">
            <Field
              label="…o escríbelo a mano"
              hint="Una frase por línea. Se reparten en el rango elegido."
            >
              <Textarea
                aria-label="Texto a mano"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={4}
              />
            </Field>
            <Button variant="outline" onClick={applyManualText}>
              Usar este texto
            </Button>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Idioma del contenido">
              <SelectField
                aria-label="Idioma del contenido"
                value={language}
                onValueChange={setLanguage}
                options={LANGS.map(([value, label]) => ({ value, label }))}
              />
            </Field>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("file")}>
              ← Volver
            </Button>
            <Button variant="default" onClick={() => setStep("range")}>
              Continuar
            </Button>
          </div>
          <p className="text-xs text-ink-soft">
            Sin subtítulos también puedes continuar: la práctica usará una sola
            ronda con el rango completo.
          </p>
        </section>
      )}

      {step === "range" && (
        <section className="space-y-4">
          <Eyebrow>Paso 4 · Rango</Eyebrow>
          <h1 className="h-display text-2xl">Recorta lo que vas a practicar</h1>
          <p className="text-sm text-ink-soft">
            El recorte es virtual: marca un tramo del medio original sin ocupar
            espacio.
          </p>

          <RangeSelector
            duration={duration || range.end}
            start={range.start}
            end={range.end}
            onChange={(s, e) => setRange({ start: s, end: e })}
            onPreview={async () => {
              const el = previewRef.current;
              if (!el || !file) return;
              if (!el.src) el.src = URL.createObjectURL(file);
              el.currentTime = range.start;
              await el.play();
              const stop = () => {
                if (el.currentTime >= range.end) {
                  el.pause();
                  el.removeEventListener("timeupdate", stop);
                }
              };
              el.addEventListener("timeupdate", stop);
            }}
          />
          <audio ref={previewRef as React.RefObject<HTMLAudioElement>} hidden />

          {cues.length > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                setRange({
                  start: cues[0]!.start,
                  end: cues[cues.length - 1]!.end,
                })
              }
            >
              Usar el rango de todos los subtítulos
            </Button>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("subs")}>
              ← Volver
            </Button>
            <Button variant="default" onClick={() => setStep("rounds")}>
              Continuar
            </Button>
          </div>
        </section>
      )}

      {step === "youtube" && (
        <YouTubeStep language={language} onBack={() => setStep("source")} />
      )}

      {(step === "tts" || step === "script") && (
        <TextSourceStep
          variant={step === "tts" ? "tts" : "script"}
          language={language}
          onBack={() => setStep("source")}
        />
      )}

      {step === "rounds" && (
        <section className="space-y-4">
          <Eyebrow>Paso 5 · Rondas y actividad</Eyebrow>
          <h1 className="h-display text-2xl">
            {seeds.length || 1} rondas de práctica
          </h1>

          <ol className="space-y-2">
            {(seeds.length
              ? seeds
              : [
                  {
                    index: 0,
                    startSec: range.start,
                    endSec: range.end,
                    text: manualText.trim() || "(rango completo, sin texto)",
                  },
                ]
            ).map((s) => (
              <li
                key={s.index}
                className="rounded-lg border-2 border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="mr-2 font-mono text-xs text-ink-soft">
                  {fmtClock(s.startSec)}–{fmtClock(s.endSec)}
                </span>
                {s.text || <span className="text-ink-soft">(sin texto)</span>}
              </li>
            ))}
          </ol>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Actividad">
              <SelectField
                aria-label="Actividad"
                value="shadowing-echo"
                onValueChange={() => {}}
                disabled
                options={[{ value: "shadowing-echo", label: "Shadowing · Eco" }]}
              />
            </Field>
            <Field
              label="Mostrar el texto"
              hint="&ldquo;Escalera&rdquo;: se atenúa y luego se oculta por vuelta."
            >
              <SelectField
                aria-label="Mostrar el texto"
                value={showText}
                onValueChange={(v) =>
                  setShowText(v as "always" | "fade" | "never")
                }
                options={[
                  { value: "always", label: "Siempre" },
                  { value: "fade", label: "Escalera (recomendado)" },
                  { value: "never", label: "Nunca" },
                ]}
              />
            </Field>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("range")}>
              ← Volver
            </Button>
            <Button variant="default" onClick={finish} disabled={!!busy}>
              Crear y empezar
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

const STEP_ORDER: Record<Step, number> = {
  source: 0,
  file: 1,
  subs: 2,
  range: 3,
  rounds: 4,
  youtube: 1,
  tts: 1,
  script: 1,
};
const STEP_LABEL: Record<Step, string> = {
  source: "Origen",
  file: "Archivo",
  subs: "Subtítulos",
  range: "Rango",
  rounds: "Rondas",
  youtube: "YouTube",
  tts: "Voz IA",
  script: "Guion",
};
