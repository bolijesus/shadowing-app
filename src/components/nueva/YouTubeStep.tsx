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
  YOUTUBE_LIMITS_NOTE,
  YouTubeRangePlayer,
  parseYouTubeId,
} from "@/lib/youtube/iframe";
import {
  fetchCaptions,
  listCaptionTracks,
  type CaptionTrack,
} from "@/lib/youtube/captions";
import { parseSubtitles } from "@/lib/subtitles/parse";
import {
  segmentFromCues,
  MAX_GROUPED_SEC,
} from "@/lib/subtitles/segmentation";
import {
  createClip,
  createMedia,
  createPractice,
  createRounds,
  createTranscript,
} from "@/lib/db/repositories";
import type { Cue, ShowText } from "@/lib/types";
import { fmtClock } from "@/lib/util";

/** Fuente YouTube (§4.2), con sus límites dichos claramente. */
export function YouTubeStep({
  language,
  onBack,
}: {
  language: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [videoId, setVideoId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [lang, setLang] = React.useState(language);
  const [duration, setDuration] = React.useState(0);
  const [range, setRange] = React.useState({ start: 0, end: 40 });
  const [cues, setCues] = React.useState<Cue[]>([]);
  const [tracks, setTracks] = React.useState<CaptionTrack[] | null>(null);
  const [tracksState, setTracksState] = React.useState<
    "idle" | "loading" | "none" | "ok"
  >("idle");
  const [manualText, setManualText] = React.useState("");
  const [showText, setShowText] = React.useState<ShowText>("fade");
  const [phrasesPerRound, setPhrasesPerRound] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** Si el usuario ya movió el rango, cargar subtítulos no debe pisarlo. */
  const touchedRange = React.useRef(false);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<YouTubeRangePlayer | null>(null);

  // Monta el reproductor cuando hay un id válido.
  React.useEffect(() => {
    if (!videoId || !hostRef.current) return;
    let cancelled = false;
    const host = document.createElement("div");
    hostRef.current.innerHTML = "";
    hostRef.current.appendChild(host);
    const p = new YouTubeRangePlayer();
    p.mount(host, videoId)
      .then(() => {
        if (cancelled) return;
        playerRef.current = p;
        const d = p.duration;
        if (d > 0) {
          setDuration(d);
          setRange((r) => ({ start: r.start, end: Math.min(d, r.end || 40) }));
        }
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      p.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  React.useEffect(() => {
    playerRef.current?.setRange(range.start, range.end);
  }, [range.start, range.end]);

  async function load() {
    setError(null);
    const id = parseYouTubeId(url);
    if (!id) {
      setError("No reconocemos ese enlace. Pega la URL completa del vídeo.");
      return;
    }
    setVideoId(id);
    setTracksState("loading");
    const list = await listCaptionTracks(id);
    if (!list || list.length === 0) {
      setTracks(null);
      setTracksState("none");
    } else {
      setTracks(list);
      setTracksState("ok");
    }
  }

  async function useTrack(trackLang: string) {
    if (!videoId) return;
    const got = await fetchCaptions(videoId, trackLang);
    if (!got) {
      setTracksState("none");
      return;
    }
    setCues(got);
    // El rango elegido no se pisa: solo se propone ajustarlo (botón abajo).
    if (!touchedRange.current) {
      setRange({
        start: got[0]!.start,
        end: Math.min(got[got.length - 1]!.end, got[0]!.start + 60),
      });
    }
  }

  async function onSubsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const parsed = parseSubtitles(f.name, await f.text());
    if (!parsed.length) {
      setError("No se reconocieron subtítulos en ese archivo. Prueba .srt o .vtt.");
      return;
    }
    setError(null);
    setCues(parsed);
    if (!touchedRange.current) {
      setRange({
        start: parsed[0]!.start,
        end: Math.min(parsed[parsed.length - 1]!.end, parsed[0]!.start + 60),
      });
    }
  }

  function applyManual() {
    const lines = manualText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const span = (range.end - range.start) / lines.length;
    setCues(
      lines.map((text, i) => ({
        start: range.start + i * span,
        end: range.start + (i + 1) * span,
        text,
      })),
    );
  }

  const seeds = React.useMemo(
    () =>
      cues.length
        ? segmentFromCues(cues, range.start, range.end, { phrasesPerRound })
        : [],
    [cues, range.start, range.end, phrasesPerRound],
  );

  async function create() {
    if (!videoId) return;
    setBusy(true);
    setError(null);
    try {
      const media = await createMedia({
        title: title.trim() || "Vídeo de YouTube",
        language: lang,
        source: {
          kind: "youtube",
          videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
        durationSec: duration || range.end,
        hasVideo: true,
      });
      if (cues.length) await createTranscript(media.id, "youtube-captions", cues);

      const clip = await createClip(
        media.id,
        range.start,
        range.end,
        title || "Recorte",
      );
      const rounds = await createRounds(
        clip.id,
        seeds.length
          ? seeds
          : [{ index: 0, startSec: range.start, endSec: range.end, text: "" }],
      );
      const practice = await createPractice({
        title: title.trim() || "Práctica de YouTube",
        clipId: clip.id,
        mode: "shadowing-echo",
        roundIds: rounds.map((r) => r.id),
        showText,
      });
      router.push(`/practica/${practice.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la práctica.");
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <Eyebrow>YouTube</Eyebrow>
        <h1 className="h-display mt-1 text-2xl">Practica sobre un vídeo</h1>
      </div>

      <div className="rounded-xl border-l-4 border-brand bg-brand-tint p-4 text-sm text-ink">
        <p className="font-bold">Qué se puede y qué no</p>
        <p className="mt-1">{YOUTUBE_LIMITS_NOTE}</p>
        <p className="mt-2 text-ink-soft">
          El navegador no da acceso al audio del reproductor, así que aquí no
          hay onda del modelo ni nota acústica. Sí hay rangos, bucles,
          subtítulos, texto y análisis de tu voz. No se descarga nada del vídeo.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-sm font-medium text-ink">
          {error}
        </div>
      )}

      <Card className="space-y-3">
        <Field label="Enlace del vídeo">
          <div className="flex gap-2">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              onKeyDown={(e) => e.key === "Enter" && void load()}
            />
            <Button onClick={load}>Cargar</Button>
          </div>
        </Field>
      </Card>

      {videoId && (
        <>
          <Card className="space-y-3">
            <div
              ref={hostRef}
              className="aspect-video w-full overflow-hidden rounded-lg bg-panel [&_iframe]:h-full [&_iframe]:w-full"
            />
            <RangeSelector
              duration={duration || Math.max(range.end, 60)}
              start={range.start}
              end={range.end}
              onChange={(s, e) => {
                touchedRange.current = true;
                setRange({ start: s, end: e });
              }}
              onPreview={() => playerRef.current?.play(true)}
            />
          </Card>

          <Card className="space-y-3">
            <p className="font-bold">Subtítulos</p>

            {tracksState === "loading" && (
              <p className="text-sm text-ink-soft">Buscando pistas…</p>
            )}

            {tracksState === "ok" && tracks && (
              <div className="flex flex-wrap gap-2">
                {tracks.map((t) => (
                  <Button
                    key={t.lang + t.kind}
                    variant="outline"
                    size="sm"
                    onClick={() => void useTrack(t.lang)}
                  >
                    {t.name} ({t.lang})
                  </Button>
                ))}
              </div>
            )}

            {tracksState === "none" && (
              <p className="text-sm text-ink-soft">
                No encontramos subtítulos para este vídeo. Sube un .srt o
                escribe las frases aquí abajo.
              </p>
            )}

            <Field label="Subir archivo de subtítulos" hint=".srt, .vtt o .ass">
              <input
                type="file"
                accept=".srt,.vtt,.ass,.ssa,text/vtt"
                onChange={onSubsFile}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-primary-foreground"
              />
            </Field>

            <Field label="…o escribe las frases" hint="Una por línea.">
              <Textarea
                aria-label="Frases a mano"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={3}
              />
            </Field>
            <Button variant="outline" size="sm" onClick={applyManual}>
              Usar este texto
            </Button>

            {cues.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="ok">
                  {
                    cues.filter(
                      (c) => c.end > range.start && c.start < range.end,
                    ).length
                  }{" "}
                  de {cues.length} líneas en el tramo elegido
                </Pill>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    touchedRange.current = true;
                    setRange({
                      start: cues[0]!.start,
                      end: cues[cues.length - 1]!.end,
                    });
                  }}
                >
                  Ajustar el rango a los subtítulos
                </Button>
              </div>
            )}
          </Card>

          <Card className="grid gap-4 sm:grid-cols-3">
            <Field label="Título">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                  { value: "fade", label: "Escalera" },
                  { value: "never", label: "Nunca" },
                ]}
              />
            </Field>
          </Card>

          {cues.length > 0 && (
            <Card className="space-y-2">
              <span className="text-sm font-bold">Frases por ronda</span>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <Button
                    key={n}
                    variant={phrasesPerRound === n ? "default" : "outline"}
                    size="sm"
                    aria-pressed={phrasesPerRound === n}
                    onClick={() => setPhrasesPerRound(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-ink-soft">
                Cuántas frases seguidas quieres imitar de una vez. Las rondas
                no pasan de {MAX_GROUPED_SEC} s aunque pidas más frases.
              </p>
            </Card>
          )}

          <p className="text-sm text-ink-soft">
            {seeds.length || 1} rondas · recorte de {fmtClock(range.end - range.start)}
          </p>
        </>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Volver
        </Button>
        <Button onClick={create} disabled={!videoId || busy}>
          {busy ? "Creando…" : "Crear práctica"}
        </Button>
      </div>
    </section>
  );
}
