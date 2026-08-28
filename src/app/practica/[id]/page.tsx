"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Clip, MediaItem, Practice, Round, Transcript } from "@/lib/types";
import { Button, Eyebrow } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentedProgress } from "@/components/practice/SegmentedProgress";
import { SpeedControl } from "@/components/practice/SpeedControl";
import { PhraseWithIpa } from "@/components/practice/PhraseWithIpa";
import { Countdown } from "@/components/practice/Countdown";
import { useShortcuts } from "@/lib/keyboard/useShortcuts";
import { RangePlayer } from "@/lib/audio/rangePlayer";
import {
  VoiceRecorder,
  defaultLatencyOffsetMs,
} from "@/lib/audio/recorder";
import { ensureAudioContext } from "@/lib/audio/context";
import { resolveMediaSource, requestHandlePermission } from "@/lib/media/source";
import { mediaFileCache } from "@/lib/media/fileCache";
import { getOrBuildPeaks } from "@/lib/audio/peaks";
import {
  analyzeTake,
  getOrBuildRoundAnalysis,
  saveTakeAnalysis,
  type Analysis,
} from "@/lib/audio/analysis";
import { scoreRound, contourForDisplay } from "@/lib/scoring/scoreRound";
import { buildAdvice } from "@/lib/scoring/advice";
import { WaveformPanel } from "@/components/waveform/WaveformPanel";
import { ScoreBreakdown } from "@/components/practice/ScoreBreakdown";
import { FileTooLargeToDecode } from "@/lib/audio/decode";
import { speakWithBrowser, cancelBrowserSpeech } from "@/lib/tts/browser";
import type { Peaks } from "@/workers/audio-dsp.worker";
import { putBlob } from "@/lib/storage/blobStore";
import { readAsBlob } from "@/lib/storage/opfs";
import {
  YOUTUBE_LIMITS_NOTE,
  YouTubeRangePlayer,
} from "@/lib/youtube/iframe";
import { saveTake } from "@/lib/db/repositories";
import { useSettings } from "@/lib/stores/settings";
import { extForMime, fmtClock, uid } from "@/lib/util";

type Phase = "listen" | "countdown" | "recording" | "compare";

export default function PracticePlayerPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const practiceId = params.id;

  const practice = useLiveQuery<Practice | undefined>(
    () => db().practices.get(practiceId),
    [practiceId],
  );
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
                  practice.roundIds.indexOf(a.id) -
                  practice.roundIds.indexOf(b.id),
              ),
            )
        : [],
    [practice?.roundIds.join(",")],
  );
  const transcript = useLiveQuery<Transcript | undefined>(
    () =>
      media?.transcriptId ? db().transcripts.get(media.transcriptId) : undefined,
    [media?.transcriptId],
  );

  const usesHeadphones = useSettings((s) => s.usesHeadphones);
  const setSetting = useSettings((s) => s.set);
  const defaultRate = useSettings((s) => s.defaultRate);
  const rateRef = React.useRef(1);

  const [file, setFile] = React.useState<Blob | null>(null);
  const sourceKind = media?.source.kind ?? "local-file";
  const isYouTube = sourceKind === "youtube";
  const isTts = sourceKind === "tts";
  const [sourceIssue, setSourceIssue] = React.useState<
    | { kind: "permission"; handle: FileSystemFileHandle; fileName: string }
    | { kind: "missing"; reason: string }
    | null
  >(null);
  const [peaks, setPeaks] = React.useState<Peaks | null>(null);
  const [peaksNote, setPeaksNote] = React.useState<string | null>(null);

  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("listen");
  const [modelPos, setModelPos] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const [recPct, setRecPct] = React.useState(0);
  const [loop, setLoop] = React.useState(false);
  const loopRef = React.useRef(false);
  const [textHidden, setTextHidden] = React.useState(false);
  const [takes, setTakes] = React.useState<Record<string, { url: string; blob: Blob; mime: string; dur: number }>>(
    {},
  );
  const [youAnalysis, setYouAnalysis] = React.useState<Analysis | null>(null);
  const [modelAnalysis, setModelAnalysis] = React.useState<Analysis | null>(null);
  const modelAnalysisRef = React.useRef<Analysis | null>(null);
  const [showIntonation, setShowIntonation] = React.useState(true);
  const [showIpa, setShowIpa] = React.useState(false);
  const [scoring, setScoring] = React.useState(false);
  const [roundScore, setRoundScore] = React.useState<
    ReturnType<typeof scoreRound> | null
  >(null);

  const [showHeadphones, setShowHeadphones] = React.useState(false);
  const [showMicExplain, setShowMicExplain] = React.useState(false);
  const micGranted = React.useRef(false);
  const pendingRecord = React.useRef(false);

  const mediaElRef = React.useRef<HTMLMediaElement | null>(null);
  const playerRef = React.useRef<RangePlayer | null>(null);
  const recorderRef = React.useRef<VoiceRecorder | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);
  const desiredRangeRef = React.useRef<[number, number]>([0, 0]);
  const ytHostRef = React.useRef<HTMLDivElement>(null);
  const ytRef = React.useRef<YouTubeRangePlayer | null>(null);

  React.useEffect(() => {
    setRate(defaultRate);
    rateRef.current = defaultRate;
  }, [defaultRate]);

  const round = rounds?.[idx];
  const total = rounds?.length ?? 0;
  const doneFlags = React.useMemo(
    () => (rounds ?? []).map((r) => !!takes[r.id]),
    [rounds, takes],
  );

  /* --- resolver el archivo del medio --- */
  React.useEffect(() => {
    if (!media) return;
    // YouTube no da bytes (§4.2) y TTS guarda un audio por ronda, no un
    // archivo único: ninguno de los dos pasa por resolveMediaSource.
    if (media.source.kind === "youtube" || media.source.kind === "tts") {
      setFile(null);
      setSourceIssue(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = mediaFileCache.get(media.id);
      if (cached) {
        if (!cancelled) {
          setFile(cached);
          setSourceIssue(null);
        }
        return;
      }
      const res = await resolveMediaSource(media);
      if (cancelled) return;
      if (res.kind === "ready") {
        mediaFileCache.set(media.id, res.file);
        setFile(res.file);
        setSourceIssue(null);
      } else if (res.kind === "needs-permission") {
        setSourceIssue({
          kind: "permission",
          handle: res.handle,
          fileName: res.fileName,
        });
      } else {
        setSourceIssue({ kind: "missing", reason: res.reason });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  /* --- audio generado por TTS de la ronda actual --- */
  React.useEffect(() => {
    if (!isTts || !round) return;
    let cancelled = false;
    setFile(null);
    if (!round.modelAudioRef) {
      setSourceIssue({
        kind: "missing",
        reason:
          "Esta ronda todavía no tiene voz generada. Ábrela en el editor y pulsa «Generar voz».",
      });
      return;
    }
    setSourceIssue(null);
    readAsBlob(round.modelAudioRef, "audio/wav")
      .then((b) => !cancelled && setFile(b))
      .catch(
        () =>
          !cancelled &&
          setSourceIssue({
            kind: "missing",
            reason: "No se encontró el audio generado. Vuelve a generarlo.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [isTts, round]);

  /* --- reproductor de YouTube (sin acceso al audio, §4.2) --- */
  React.useEffect(() => {
    if (!isYouTube || !media || media.source.kind !== "youtube") return;
    const host = ytHostRef.current;
    if (!host) return;
    let cancelled = false;
    const inner = document.createElement("div");
    host.innerHTML = "";
    host.appendChild(inner);
    const yt = new YouTubeRangePlayer();
    yt.mount(inner, media.source.videoId)
      .then(() => {
        if (!cancelled) ytRef.current = yt;
      })
      .catch(() => {
        if (!cancelled)
          setSourceIssue({
            kind: "missing",
            reason: "No se pudo cargar el reproductor de YouTube. ¿Hay conexión?",
          });
      });
    let raf = 0;
    const tick = () => {
      setModelPos(yt.position);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      yt.destroy();
      ytRef.current = null;
    };
  }, [isYouTube, media]);

  React.useEffect(() => {
    if (!isYouTube || !round) return;
    ytRef.current?.setRange(round.startSec, round.endSec);
    ytRef.current?.setLoop(loop);
  }, [isYouTube, round, loop]);

  /* --- montar el elemento multimedia + RangePlayer --- */
  React.useEffect(() => {
    if (!file || !media) return;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const el = document.createElement(
      media.hasVideo ? "video" : "audio",
    ) as HTMLMediaElement;
    el.src = url;
    el.preload = "auto";
    mediaElRef.current = el;
    const rp = new RangePlayer(el);
    rp.playbackRate = rateRef.current;
    rp.onEnded(() => setPhase((p) => (p === "listen" ? "listen" : p)));
    // Al llegar el audio se crea un reproductor nuevo: hay que darle el
    // rango de la ronda aquí, o se quedaría con [0, 0] y se pausaría solo.
    const [rs, re] = desiredRangeRef.current;
    rp.setRange(rs, re);
    rp.setLoop(loopRef.current);
    playerRef.current = rp;

    let raf = 0;
    const tick = () => {
      setModelPos(rp.position);
      setPlaying(rp.playing);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      rp.destroy();
      URL.revokeObjectURL(url);
      playerRef.current = null;
      mediaElRef.current = null;
    };
  }, [file, media]);

  /* --- construir picos del recorte --- */
  React.useEffect(() => {
    if (!file || !clip) return;
    let cancelled = false;
    setPeaks(null);
    setPeaksNote(null);
    (async () => {
      try {
        const p = await getOrBuildPeaks({
          clipId: isTts && round ? `${clip.id}_${round.id}` : clip.id,
          file,
          startSec: isTts ? 0 : clip.startSec,
          endSec: isTts ? Number.MAX_SAFE_INTEGER : clip.endSec,
        });
        if (!cancelled) setPeaks(p);
      } catch (e) {
        if (!cancelled) {
          setPeaksNote(
            e instanceof FileTooLargeToDecode
              ? "Archivo muy grande: la onda no se muestra en esta versión."
              : "No se pudo generar la forma de onda.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, clip, isTts, round]);

  /* --- rango del RangePlayer para la ronda actual --- */
  React.useEffect(() => {
    loopRef.current = loop;
    if (!round) return;
    desiredRangeRef.current = isTts
      ? [0, Number.MAX_SAFE_INTEGER]
      : [round.startSec, round.endSec];
    if (!playerRef.current) return;
    // En TTS cada ronda es su propio archivo: el rango es todo el blob.
    const range: [number, number] = isTts
      ? [0, Number.MAX_SAFE_INTEGER]
      : [round.startSec, round.endSec];
    desiredRangeRef.current = range;
    playerRef.current.setRange(range[0], range[1]);
    playerRef.current.setLoop(loop);
    setPhase("listen");
    setRecPct(0);
    setYouAnalysis(null);
    setRoundScore(null);
  }, [round, loop, isTts]);

  /* --- análisis del modelo de la ronda (F0 + energía), cacheado --- */
  React.useEffect(() => {
    if (!file || !round) return;
    let cancelled = false;
    setModelAnalysis(null);
    modelAnalysisRef.current = null;
    (async () => {
      try {
        const a = await getOrBuildRoundAnalysis(
          round.id,
          file,
          isTts ? 0 : round.startSec,
          isTts ? Number.MAX_SAFE_INTEGER : round.endSec,
        );
        if (!cancelled) {
          setModelAnalysis(a);
          modelAnalysisRef.current = a;
        }
      } catch {
        if (!cancelled) {
          setModelAnalysis(null);
          modelAnalysisRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, round, isTts]);

  /* --- primera visita: ¿auriculares? --- */
  React.useEffect(() => {
    if (usesHeadphones === null) setShowHeadphones(true);
  }, [usesHeadphones]);

  const modelContour = React.useMemo(
    () => (modelAnalysis ? contourForDisplay(modelAnalysis.semitones) : null),
    [modelAnalysis],
  );
  const youContour = React.useMemo(
    () => (youAnalysis ? contourForDisplay(youAnalysis.semitones) : null),
    [youAnalysis],
  );

  const roundPeaks = React.useMemo<Peaks | null>(() => {
    if (isTts) return peaks;
    if (!peaks || !clip || !round) return peaks;
    const clipDur = clip.endSec - clip.startSec || 1;
    const a = Math.max(0, (round.startSec - clip.startSec) / clipDur);
    const b = Math.min(1, (round.endSec - clip.startSec) / clipDur);
    const from = Math.floor(a * peaks.buckets);
    const to = Math.max(from + 1, Math.ceil(b * peaks.buckets));
    return {
      buckets: to - from,
      durationSec: round.endSec - round.startSec,
      minmax: peaks.minmax.slice(from * 2, to * 2),
    };
  }, [peaks, clip, round, isTts]);

  function applyRate(v: number) {
    setRate(v);
    rateRef.current = v;
    // preservesPitch evita el efecto "ardilla" y conserva la entonación (§13.4).
    if (playerRef.current) playerRef.current.playbackRate = v;
    ytRef.current?.setRate(v);
  }

  function playModel(fromStart = true) {
    if (isYouTube) {
      ytRef.current?.play(fromStart);
      setPlaying(true);
      return;
    }
    ensureAudioContext();
    void playerRef.current?.play(fromStart);
  }
  function pauseModel() {
    if (isYouTube) {
      ytRef.current?.pause();
      setPlaying(false);
      return;
    }
    playerRef.current?.pause();
  }

  function startCountdown() {
    if (!micGranted.current) {
      pendingRecord.current = true;
      setShowMicExplain(true);
      return;
    }
    pauseModel();
    setPhase("countdown");
  }

  async function beginRecording() {
    if (!round) return;
    const rec = new VoiceRecorder();
    recorderRef.current = rec;
    try {
      await rec.start({ disableEchoCancellation: usesHeadphones === true });
    } catch {
      setPhase("listen");
      setSourceIssue(null);
      return;
    }
    setPhase("recording");
    setRecPct(0);
    const targetMs = Math.max(1200, (round.endSec - round.startSec) * 1000);
    const startedAt = performance.now();
    const iv = setInterval(() => {
      const p = (performance.now() - startedAt) / targetMs;
      setRecPct(Math.min(1, p));
      if (p >= 1.25) {
        clearInterval(iv);
        void stopRecording();
      }
    }, 60);
    (rec as unknown as { _iv?: number })._iv = iv as unknown as number;
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    if (!rec || !round) return;
    const iv = (rec as unknown as { _iv?: number })._iv;
    if (iv) clearInterval(iv);
    const result = await rec.stop();
    recorderRef.current = null;
    const url = URL.createObjectURL(result.blob);
    setTakes((t) => {
      const prev = t[round.id];
      if (prev) URL.revokeObjectURL(prev.url);
      return {
        ...t,
        [round.id]: {
          url,
          blob: result.blob,
          mime: result.mime,
          dur: result.durationSec,
        },
      };
    });
    setPhase("compare");
    setRecPct(1);

    // Análisis de la toma y puntuación frente al modelo.
    setScoring(true);
    try {
      const latency =
        useSettings.getState().micLatencyOffsetMs ?? defaultLatencyOffsetMs();
      const takeAnalysis = await analyzeTake(result.blob, latency);
      setYouAnalysis(takeAnalysis);
      const modelA = modelAnalysisRef.current;
      if (modelA) {
        const sc = scoreRound({
          model: modelA,
          take: takeAnalysis,
          weights: useSettings.getState().scoreWeights,
        });
        setRoundScore({ ...sc, tip: buildAdvice(sc) });
      }
    } catch {
      setYouAnalysis(null);
      setRoundScore(null);
    } finally {
      setScoring(false);
    }
  }

  function playMine() {
    if (!round) return;
    const t = takes[round.id];
    if (!t) return;
    const a = new Audio(t.url);
    void a.play().catch(() => {});
  }
  function playBoth() {
    playModel(true);
    playMine();
  }

  const savedScores = React.useRef<Record<string, number>>({});

  async function saveAndContinue() {
    if (!round) return;
    if (roundScore) savedScores.current[round.id] = roundScore.total;

    const t = takes[round.id];
    if (t) {
      const ext = extForMime(t.mime);
      const takeId = uid("tk");
      const path = `recordings/${takeId}.${ext}`;
      await putBlob(path, t.blob, "recording", takeId);

      let analysisRef: string | undefined;
      if (youAnalysis) analysisRef = await saveTakeAnalysis(takeId, youAnalysis);

      await saveTake({
        id: takeId,
        roundId: round.id,
        createdAt: Date.now(),
        audioRef: path,
        mime: t.mime,
        durationSec: t.dur,
        latencyOffsetMs:
          useSettings.getState().micLatencyOffsetMs ?? defaultLatencyOffsetMs(),
        analysisRef,
        score: roundScore
          ? {
              total: roundScore.total,
              components: roundScore.components,
              present: roundScore.present,
              weights: roundScore.weights,
              engineVersion: roundScore.engineVersion,
              detail: roundScore.detail,
              tip: buildAdvice(roundScore),
            }
          : undefined,
        kept: true,
      });
    }

    if (idx + 1 < total) {
      setIdx(idx + 1);
    } else {
      const scores = Object.values(savedScores.current);
      await db().practices.update(practiceId, {
        lastPracticedAt: Date.now(),
        lastScore: scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : undefined,
      });
      router.push(`/resultados/${practiceId}`);
    }
  }

  useShortcuts(
    {
      playPause: () => (playing ? pauseModel() : playModel(false)),
      record: () =>
        phase === "recording"
          ? void stopRecording()
          : phase === "listen" || phase === "compare"
            ? startCountdown()
            : undefined,
      prev: () => setIdx((i) => Math.max(0, i - 1)),
      next: () => setIdx((i) => Math.min(total - 1, i + 1)),
      loop: () => setLoop((v) => !v),
      toggleText: () => setTextHidden((v) => !v),
      toggleIpa: () => setShowIpa((v) => !v),
    },
    phase !== "countdown",
  );

  if (practice === undefined) {
    return <CenterNote>Cargando práctica…</CenterNote>;
  }
  if (practice === null || !practice) {
    return <CenterNote>Esta práctica ya no existe.</CenterNote>;
  }

  const showTextMode = practice.showText;
  const textOpacity =
    textHidden || showTextMode === "never"
      ? 0
      : showTextMode === "fade" && idx >= 1
        ? idx >= 2
          ? 0
          : 0.4
        : 1;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-bg">
      <header className="flex items-center justify-between border-b-2 border-line bg-surface px-4 py-3">
        <button
          onClick={() => router.push("/")}
          className="rounded-lg border-2 border-line-strong px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
        >
          ✕ Salir
        </button>
        <p className="text-sm font-bold">
          Ronda {idx + 1} de {total}
        </p>
        <span className="text-xs font-semibold text-ink-soft">
          {Object.keys(takes).length}/{total} tomas
        </span>
      </header>

      <div className="px-4 pt-3">
        <SegmentedProgress
          total={total}
          done={doneFlags}
          current={idx}
          onJump={(i) => setIdx(i)}
        />
      </div>

      {sourceIssue && (
        <div className="mx-4 mt-3 rounded-lg border-2 border-brand bg-brand-tint px-4 py-3 text-sm text-brand-ink">
          {sourceIssue.kind === "permission" ? (
            <div className="space-y-2">
              <p>
                Se necesita permiso para volver a abrir{" "}
                <strong>{sourceIssue.fileName}</strong>.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await requestHandlePermission(sourceIssue.handle);
                  if (ok) {
                    const f = await sourceIssue.handle.getFile();
                    mediaFileCache.set(media!.id, f);
                    setFile(f);
                    setSourceIssue(null);
                  }
                }}
              >
                Dar permiso
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p>{sourceIssue.reason}</p>
              <label className="block text-xs">
                <span className="mb-1 block">Volver a seleccionar el archivo:</span>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && media) {
                      mediaFileCache.set(media.id, f);
                      setFile(f);
                      setSourceIssue(null);
                    }
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      <main className="flex flex-1 flex-col gap-5 px-4 py-6">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{practice.title}</p>
              <h1 className="h-display mt-1 text-2xl">Imita al modelo</h1>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setShowIpa((v) => !v)}
                aria-pressed={showIpa}
                className="rounded-lg border-2 border-line-strong bg-surface px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
              >
                {showIpa ? "Ocultar IPA" : "Ver IPA"}
              </button>
              <button
                onClick={() => setTextHidden((v) => !v)}
                className="rounded-lg border-2 border-line-strong bg-surface px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
              >
                {textOpacity === 0 ? "Mostrar texto" : "Ocultar texto"}
              </button>
            </div>
          </div>
          <div
            className="mt-3 rounded-xl bg-panel p-5 transition-opacity"
            style={{ opacity: textOpacity || 0.001 }}
            aria-hidden={textOpacity === 0}
          >
            <PhraseWithIpa
              text={round?.text ?? ""}
              language={media?.language ?? "en-US"}
              showIpa={showIpa}
            />
          </div>
        </div>

        {isYouTube && (
          <div className="space-y-2">
            <div
              ref={ytHostRef}
              className="aspect-video w-full overflow-hidden rounded-xl bg-panel [&_iframe]:h-full [&_iframe]:w-full"
            />
            <p className="rounded-lg border-l-4 border-brand bg-brand-tint px-3 py-2 text-xs text-ink">
              {YOUTUBE_LIMITS_NOTE}
            </p>
          </div>
        )}

        <div className="space-y-3" hidden={isYouTube}>
          <WaveformPanel
            label="Modelo"
            peaks={roundPeaks}
            contour={modelContour}
            progress={modelPos}
            tone={
              phase === "recording"
                ? "recording"
                : playing
                  ? "playing"
                  : "reference"
            }
            height={120}
            showIntonation={showIntonation}
            onToggleIntonation={() => setShowIntonation((v) => !v)}
          />
          {(phase === "compare" || youAnalysis) && (
            <WaveformPanel
              label="Tú"
              peaks={youAnalysis?.peaks ?? null}
              contour={youContour}
              height={96}
              showIntonation={showIntonation}
            />
          )}
          {peaksNote && <p className="text-xs text-ink-soft">{peaksNote}</p>}
        </div>

        {isYouTube && (phase === "compare" || youAnalysis) && (
          <WaveformPanel
            label="Tú"
            peaks={youAnalysis?.peaks ?? null}
            contour={youContour}
            height={96}
            showIntonation={showIntonation}
          />
        )}

        {phase === "recording" && <DotMeter value={recPct} />}

        <div className="mt-auto space-y-3">
          {phase === "countdown" && (
            <Countdown onDone={() => void beginRecording()} />
          )}

          {phase === "listen" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => (playing ? pauseModel() : playModel(true))}
                  disabled={!file}
                >
                  {playing ? "Pausar" : "Escuchar modelo"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setLoop((v) => !v)}
                  aria-pressed={loop}
                >
                  {loop ? "Bucle: activado" : "Bucle A–B"}
                </Button>
                <div className="col-span-2 flex justify-center">
                  <SpeedControl value={rate} onChange={applyRate} />
                </div>
                <Button
                  variant="outline"
                  className="col-span-2"
                  onClick={() => {
                    cancelBrowserSpeech();
                    if (round?.text)
                      void speakWithBrowser(round.text, {
                        lang: media?.language,
                      }).catch(() => {});
                  }}
                  disabled={!round?.text}
                >
                  Escuchar con voz del navegador
                </Button>
              </div>
              <Button
                variant="record"
               
                className="w-full h-16 text-lg"
                onClick={startCountdown}
              >
                ● Grabar mi voz
              </Button>
            </>
          )}

          {phase === "recording" && (
            <Button
              variant="record"
             
              className="w-full h-16 text-lg"
              onClick={() => void stopRecording()}
            >
              ■ Detener ({Math.round(recPct * 100)}%)
            </Button>
          )}

          {phase === "compare" && (
            <div className="space-y-4 rounded-xl border-2 border-line bg-surface p-4">
              <p className="text-sm text-ink-soft">
                Compara el modelo con tu toma. Guárdala cuando quieras pasar a
                la siguiente ronda.
              </p>

              {scoring && (
                <p className="text-sm font-semibold text-ink-soft">
                  Analizando tu voz…
                </p>
              )}
              {!scoring && roundScore && (
                <div className="space-y-2">
                  <Eyebrow>Coincidencia · ronda {idx + 1}</Eyebrow>
                  <ScoreBreakdown score={roundScore} />
                </div>
              )}
              {!scoring && !roundScore && youAnalysis && (
                <p className="text-sm text-ink-soft">
                  {isYouTube
                    ? "En modo YouTube no hay audio del modelo, así que no hay nota acústica. Para comparar tu entonación con la del modelo, sube el audio como archivo."
                    : "No se ha podido analizar el audio del modelo, así que esta ronda no lleva nota. Puedes escuchar y comparar igualmente."}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" onClick={() => playModel(true)}>
                  Modelo
                </Button>
                <Button variant="outline" onClick={playMine}>
                  La mía
                </Button>
                <Button variant="outline" onClick={playBoth}>
                  Juntas
                </Button>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={startCountdown}
              >
                Grabar otra vez
              </Button>
              <Button
                className="h-14 w-full"
                onClick={() => void saveAndContinue()}
                disabled={scoring}
              >
                {idx + 1 < total
                  ? "Guardar toma y continuar"
                  : "Guardar y ver resumen"}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-ink-soft">
            <button
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="disabled:opacity-30"
            >
              ← Ronda anterior
            </button>
            <span>
              {round ? `${fmtClock(round.startSec)}–${fmtClock(round.endSec)}` : ""}
            </span>
            <button
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              disabled={idx + 1 >= total}
              className="disabled:opacity-30"
            >
              Ronda siguiente →
            </button>
          </div>
        </div>
      </main>

      <Dialog open={showHeadphones} onOpenChange={(o) => !o && setShowHeadphones(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="h-display text-lg">
              ¿Estás usando auriculares?
            </DialogTitle>
            <DialogDescription>
              Sin auriculares, el micrófono capta también el audio del modelo y
              las comparaciones dejan de tener sentido. Si llevas auriculares, se
              desactiva la cancelación de eco para analizar mejor tu voz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSetting("usesHeadphones", false);
                setShowHeadphones(false);
              }}
            >
              No
            </Button>
            <Button
              onClick={() => {
                setSetting("usesHeadphones", true);
                setShowHeadphones(false);
              }}
            >
              Sí, llevo auriculares
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showMicExplain}
        onOpenChange={(o) => {
          if (!o) {
            setShowMicExplain(false);
            pendingRecord.current = false;
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="h-display text-lg">
              Permiso de micrófono
            </DialogTitle>
            <DialogDescription>
              La app pedirá acceso al micrófono para grabar tu voz. El audio se
              queda en este dispositivo: no se envía a ningún servidor.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowMicExplain(false);
                pendingRecord.current = false;
              }}
            >
              Ahora no
            </Button>
            <Button
              onClick={() => {
                micGranted.current = true;
                setShowMicExplain(false);
                if (pendingRecord.current) {
                  pendingRecord.current = false;
                  pauseModel();
                  setPhase("countdown");
                }
              }}
            >
              Permitir y grabar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-8 text-center text-ink-soft">
      {children}
    </div>
  );
}

/** Medidor de progreso de grabación por puntos (§7.A). */
function DotMeter({ value }: { value: number }) {
  const dots = 30;
  const filled = Math.round(value * dots);
  return (
    <div className="rounded-lg border-2 border-ok/40 bg-ok/5 px-3 py-3">
      <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
        <span className="text-brand-ink">Grabando</span>
        <span className="text-ink-soft">{Math.round(value * 100)}%</span>
      </div>
      <div className="flex items-end gap-1">
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className={
              i < filled
                ? "h-3 w-2 rounded-sm bg-ok"
                : "h-2 w-2 self-center rounded-full bg-line-strong/50"
            }
          />
        ))}
      </div>
    </div>
  );
}
