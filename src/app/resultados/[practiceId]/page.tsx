"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Clip, MediaItem, Round, Take } from "@/lib/types";
import { Button, Eyebrow, EmptyState } from "@/components/ui/primitives";
import { SegmentedProgress } from "@/components/practice/SegmentedProgress";
import { PhraseWithIpa } from "@/components/practice/PhraseWithIpa";
import { WaveformPanel } from "@/components/waveform/WaveformPanel";
import { WaveCompare } from "@/components/waveform/WaveCompare";
import { ContourCompare } from "@/components/waveform/ContourCompare";
import { BigScore, ScoreBreakdown } from "@/components/practice/ScoreBreakdown";
import { readAsObjectURL } from "@/lib/storage/opfs";
import { loadAnalysis, type Analysis } from "@/lib/audio/analysis";
import {
  roundAnalysis,
  refineRoundBounds,
  releaseClip,
} from "@/lib/audio/clipAnalysis";
import { useSettings } from "@/lib/stores/settings";
import { contourForDisplay, type RoundScore } from "@/lib/scoring/scoreRound";
import { resolveMediaSource } from "@/lib/media/source";
import { mediaFileCache } from "@/lib/media/fileCache";
import { RangePlayer } from "@/lib/audio/rangePlayer";
import { ensureAudioContext } from "@/lib/audio/context";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/util";

export default function ResultsPage() {
  const router = useRouter();
  const { practiceId } = useParams<{ practiceId: string }>();

  const practice = useLiveQuery(() => db().practices.get(practiceId), [practiceId]);
  const clip = useLiveQuery<Clip | undefined>(
    () => (practice ? db().clips.get(practice.clipId) : undefined),
    [practice?.clipId],
  );
  const media = useLiveQuery<MediaItem | undefined>(
    () => (clip ? db().media.get(clip.mediaId) : undefined),
    [clip?.mediaId],
  );
  const rounds = useLiveQuery<Round[]>(
    () =>
      practice
        ? db()
            .rounds.where("id")
            .anyOf(practice.roundIds)
            .toArray()
            .then((rs) =>
              rs.sort(
                (a, b) =>
                  practice.roundIds.indexOf(a.id) - practice.roundIds.indexOf(b.id),
              ),
            )
        : [],
    [practice?.roundIds.join(",")],
  );
  const takes = useLiveQuery<Take[]>(
    () =>
      rounds && rounds.length
        ? db().takes.where("roundId").anyOf(rounds.map((r) => r.id)).toArray()
        : [],
    [rounds?.map((r) => r.id).join(",")],
  );

  const [idx, setIdx] = React.useState(0);
  const [textHidden, setTextHidden] = React.useState(false);
  const [showIntonation, setShowIntonation] = React.useState(true);
  const [showIpa, setShowIpa] = React.useState(false);
  const [file, setFile] = React.useState<Blob | null>(null);

  // El worker guarda el PCM del recorte mientras se revisan las rondas.
  React.useEffect(() => () => releaseClip(), []);

  const latestByRound = React.useMemo(() => {
    const m = new Map<string, Take>();
    for (const t of takes ?? []) {
      const cur = m.get(t.roundId);
      if (!cur || t.createdAt > cur.createdAt) m.set(t.roundId, t);
    }
    return m;
  }, [takes]);

  React.useEffect(() => {
    if (!media) return;
    let cancelled = false;
    (async () => {
      const cached = mediaFileCache.get(media.id);
      if (cached) {
        if (!cancelled) setFile(cached);
        return;
      }
      const res = await resolveMediaSource(media);
      if (!cancelled && res.kind === "ready") {
        mediaFileCache.set(media.id, res.file);
        setFile(res.file);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  const scored = React.useMemo(
    () =>
      (rounds ?? []).map((r) => latestByRound.get(r.id)?.score?.total ?? null),
    [rounds, latestByRound],
  );
  const withScore = scored.filter((v): v is number => v !== null);
  const overall = withScore.length
    ? Math.round(withScore.reduce((a, b) => a + b, 0) / withScore.length)
    : null;

  if (practice === undefined) {
    return <p className="p-8 text-center text-ink-soft">Cargando resultados…</p>;
  }
  if (!practice) {
    return <EmptyState title="Sin resultados">Esta práctica ya no existe.</EmptyState>;
  }

  const total = rounds?.length ?? 0;
  const round = rounds?.[idx];
  const take = round ? latestByRound.get(round.id) : undefined;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="h-display text-xl">{practice.title}</p>
          <p className="text-sm text-ink-soft">Práctica de pronunciación</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Salir de los resultados"
          onClick={() => router.push("/")}
          className="rounded-full"
        >
          ✕
        </Button>
      </header>

      <div className="space-y-1.5">
        <p className="text-right text-sm font-bold">
          Revisando la ronda {idx + 1} de {total}
        </p>
        <SegmentedProgress
          total={total}
          done={scored.map((v) => v !== null)}
          current={idx}
          onJump={setIdx}
        />
      </div>

      {/* Resumen de la práctica completa */}
      <section className="rounded-xl border-2 border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Práctica completa</Eyebrow>
            <h1 className="h-display mt-1 text-2xl">Notas por ronda</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Revisa la práctica entera o abre cualquier ronda.
            </p>
          </div>
          {overall !== null && <BigScore value={overall} className="shrink-0" />}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(rounds ?? []).map((r, i) => (
            <button
              key={r.id}
              onClick={() => setIdx(i)}
              aria-current={i === idx}
              className={cn(
                "rounded-xl border-2 px-3 py-2.5 text-left transition-colors",
                i === idx
                  ? "border-ink bg-surface"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="block text-xs font-bold text-ink-soft">
                Ronda {i + 1}
              </span>
              <span
                className={cn(
                  "h-display block text-2xl tabular-nums",
                  scored[i] === null ? "text-ink-soft" : "text-data",
                )}
              >
                {scored[i] ?? "—"}
              </span>
            </button>
          ))}
        </div>

        {overall === null && (
          <p className="mt-3 text-sm text-ink-soft">
            Todavía no hay notas. Graba una toma en cada ronda para obtenerlas.
          </p>
        )}
      </section>

      {/* Detalle de la ronda seleccionada */}
      {round && (
        <section className="space-y-4 rounded-xl border-2 border-line bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Eyebrow>{practice.title}</Eyebrow>
              <h2 className="h-display mt-1 text-2xl">
                Revisión de la ronda {idx + 1}
              </h2>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-pressed={showIpa}
                onClick={() => setShowIpa((v) => !v)}
              >
                {showIpa ? "Ocultar IPA" : "Ver IPA"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTextHidden((v) => !v)}
              >
                {textHidden ? "Mostrar texto" : "Ocultar texto"}
              </Button>
            </div>
          </div>

          <div
            className="rounded-xl bg-panel p-5 transition-opacity"
            style={{ opacity: textHidden ? 0.001 : 1 }}
            aria-hidden={textHidden}
          >
            <PhraseWithIpa
              text={round.text}
              language={media?.language ?? "en-US"}
              showIpa={showIpa}
            />
          </div>

          <RoundDetail
            key={round.id}
            round={round}
            take={take}
            file={file}
            clipId={clip?.id ?? ""}
            clipStart={clip?.startSec ?? 0}
            clipEnd={clip?.endSec ?? 0}
            showIntonation={showIntonation}
            onToggleIntonation={() => setShowIntonation((v) => !v)}
          />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              Nota anterior
            </Button>
            <Button
              disabled={idx + 1 >= total}
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
            >
              Nota siguiente
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/practica/${practice.id}`}>
          <Button>Repetir práctica</Button>
        </Link>
        {practice.showText === "fade" && (practice.completedLaps ?? 0) > 0 && (
          <Button
            variant="outline"
            onClick={() =>
              db().practices.update(practice.id, { completedLaps: 0 })
            }
            title="Vuelve a mostrar el texto completo desde la vuelta 1"
          >
            Reiniciar escalera de texto
          </Button>
        )}
        <Link href={`/practica/${practice.id}/editar`}>
          <Button variant="outline">Editar rondas</Button>
        </Link>
      </div>
    </div>
  );
}

function RoundDetail({
  round,
  take,
  file,
  clipId,
  clipStart,
  clipEnd,
  showIntonation,
  onToggleIntonation,
}: {
  round: Round;
  take?: Take;
  file: Blob | null;
  /** Recorte al que pertenece: el análisis se saca de él, decodificado una vez. */
  clipId: string;
  clipStart: number;
  clipEnd: number;
  showIntonation: boolean;
  onToggleIntonation: () => void;
}) {
  const [modelA, setModelA] = React.useState<Analysis | null>(null);
  /**
   * Los mismos cortes afinados que usa la práctica. Si aquí se usaran los del
   * subtítulo, el modelo sonaría distinto al que imitaste y la nota estaría
   * calculada sobre un tramo que ya no se puede volver a escuchar.
   */
  const [bounds, setBounds] = React.useState<{
    startSec: number;
    endSec: number;
  } | null>(null);
  const phraseTailMs = useSettings((s) => s.phraseTailMs);
  const [takeA, setTakeA] = React.useState<Analysis | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const modelElRef = React.useRef<HTMLAudioElement | null>(null);
  const playerRef = React.useRef<RangePlayer | null>(null);
  const [modelPos, setModelPos] = React.useState(0);

  React.useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBounds(null);
    void refineRoundBounds(
      file,
      clipId,
      clipStart,
      clipEnd,
      round.startSec,
      round.endSec,
      { extraEndSec: phraseTailMs / 1000 },
    ).then((b) => !cancelled && setBounds(b));
    return () => {
      cancelled = true;
    };
  }, [
    file,
    clipId,
    clipStart,
    clipEnd,
    round.startSec,
    round.endSec,
    phraseTailMs,
  ]);

  const playStart = bounds?.startSec ?? round.startSec;
  const playEnd = bounds?.endSec ?? round.endSec;

  React.useEffect(() => {
    if (!file) return;
    let cancelled = false;
    roundAnalysis(file, clipId, clipStart, clipEnd, round.id, playStart, playEnd)
      .then((a) => !cancelled && setModelA(a))
      .catch(() => !cancelled && setModelA(null));
    return () => {
      cancelled = true;
    };
  }, [file, clipId, clipStart, clipEnd, round.id, playStart, playEnd]);

  React.useEffect(() => {
    let cancelled = false;
    if (take?.analysisRef) {
      loadAnalysis(take.analysisRef)
        .then((a) => !cancelled && setTakeA(a))
        .catch(() => !cancelled && setTakeA(null));
    } else {
      setTakeA(null);
    }
    return () => {
      cancelled = true;
    };
  }, [take?.analysisRef]);

  React.useEffect(() => {
    let revoked: string | null = null;
    if (take?.audioRef) {
      readAsObjectURL(take.audioRef, take.mime)
        .then((u) => {
          revoked = u;
          setUrl(u);
        })
        .catch(() => setUrl(null));
    } else {
      setUrl(null);
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [take?.audioRef, take?.mime]);

  // Reproductor del modelo, limitado al rango de la ronda.
  React.useEffect(() => {
    if (!file) return;
    const objUrl = URL.createObjectURL(file);
    const el = document.createElement("audio");
    el.src = objUrl;
    el.preload = "metadata";
    modelElRef.current = el;
    const rp = new RangePlayer(el);
    rp.setRange(playStart, playEnd);
    playerRef.current = rp;
    let raf = 0;
    const tick = () => {
      setModelPos(rp.position);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      rp.destroy();
      URL.revokeObjectURL(objUrl);
      playerRef.current = null;
    };
  }, [file, playStart, playEnd]);

  const modelContour = React.useMemo(
    () => (modelA ? contourForDisplay(modelA.semitones) : null),
    [modelA],
  );
  const takeContour = React.useMemo(
    () => (takeA ? contourForDisplay(takeA.semitones) : null),
    [takeA],
  );

  const playModel = () => {
    ensureAudioContext();
    void playerRef.current?.play(true);
  };
  const playMine = () => {
    if (url) void new Audio(url).play().catch(() => {});
  };

  const score = take?.score as RoundScore | undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Con toma grabada se comparan superpuestas; sin ella basta el
            panel del modelo con su cursor de reproducción. */}
        {takeA ? (
          <>
            <WaveCompare
              model={modelA?.peaks ?? null}
              take={takeA.peaks}
              height={130}
            />
            {showIntonation && modelContour && (
              <ContourCompare
                model={modelContour}
                take={takeContour}
                height={140}
              />
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onToggleIntonation}
                aria-pressed={showIntonation}
                className="text-xs font-bold text-brand-ink underline underline-offset-4 hover:text-ink"
              >
                {showIntonation ? "Ocultar entonación" : "Mostrar entonación"}
              </button>
            </div>
          </>
        ) : (
          <WaveformPanel
            label="Modelo"
            peaks={modelA?.peaks ?? null}
            contour={modelContour}
            progress={modelPos}
            height={110}
            showIntonation={showIntonation}
            onToggleIntonation={onToggleIntonation}
            durationSec={playEnd - playStart}
            onSeek={(r) => {
              ensureAudioContext();
              void playerRef.current?.seekRatio(r);
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Coincidencia · ronda {round.index + 1}</Eyebrow>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={playModel} disabled={!file}>
            Modelo
          </Button>
          <Button variant="outline" size="sm" onClick={playMine} disabled={!url}>
            La mía
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!url || !file}
            onClick={() => {
              playModel();
              playMine();
            }}
          >
            Juntas
          </Button>
        </div>
      </div>

      {score ? (
        <ScoreBreakdown score={score} />
      ) : take ? (
        <p className="text-sm text-ink-soft">
          Esta toma se guardó sin análisis. Vuelve a grabarla para obtener nota.
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          Sin toma guardada en esta ronda ·{" "}
          {fmtClock(playStart)}–{fmtClock(playEnd)}
        </p>
      )}

      {url && <audio controls src={url} className="w-full" preload="none" />}
    </div>
  );
}
