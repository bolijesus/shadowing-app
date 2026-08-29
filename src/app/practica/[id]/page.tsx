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
import {
  ensureClipLoaded,
  roundAnalysis,
  refineRoundBounds,
  releaseClip,
} from "@/lib/audio/clipAnalysis";
import {
  CLEAR_BOUNDS,
  effectiveBounds,
  hasManualBounds,
  type NudgePlan,
} from "@/lib/practice/roundBounds";
import { BoundsControl } from "@/components/practice/BoundsControl";
import {
  analyzeTake,
  saveTakeAnalysis,
  type Analysis,
} from "@/lib/audio/analysis";
import { scoreRound, contourForDisplay } from "@/lib/scoring/scoreRound";
import { buildAdvice } from "@/lib/scoring/advice";
import { WaveformPanel } from "@/components/waveform/WaveformPanel";
import { ScoreBreakdown } from "@/components/practice/ScoreBreakdown";
import { CurveDuel } from "@/components/games/CurveDuel";
import { ContourCompare } from "@/components/waveform/ContourCompare";
import { WaveCompare } from "@/components/waveform/WaveCompare";
import {
  FileTooLargeToDecode,
  SLOW_DECODE_BYTES,
} from "@/lib/audio/decode";
import { speakWithBrowser, cancelBrowserSpeech } from "@/lib/tts/browser";
import { putBlob } from "@/lib/storage/blobStore";
import { readAsBlob } from "@/lib/storage/opfs";
import {
  YOUTUBE_LIMITS_NOTE,
  YouTubeRangePlayer,
} from "@/lib/youtube/iframe";
import { saveTake, setRoundBounds } from "@/lib/db/repositories";
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
  const karaoke = useSettings((s) => s.karaoke);
  const phraseTailMs = useSettings((s) => s.phraseTailMs);
  const phraseNudgeSec = useSettings((s) => s.phraseNudgeSec);
  const rateRef = React.useRef(1);

  const [file, setFile] = React.useState<Blob | null>(null);
  const sourceKind = media?.source.kind ?? "local-file";
  const isYouTube = sourceKind === "youtube";
  const isTts = sourceKind === "tts";
  /** Archivo con imagen: se pinta el vídeo del recorte, no solo la onda. */
  const showsVideo = !!media?.hasVideo && !isYouTube;
  const [sourceIssue, setSourceIssue] = React.useState<
    | { kind: "permission"; handle: FileSystemFileHandle; fileName: string }
    | { kind: "missing"; reason: string }
    | null
  >(null);
  /** ¿Está el recorte decodificado? Sin esto no hay onda ni análisis. */
  const [clipReady, setClipReady] = React.useState(false);
  const [peaksNote, setPeaksNote] = React.useState<string | null>(null);
  const [peaksBusy, setPeaksBusy] = React.useState(false);
  const [peaksAttempt, setPeaksAttempt] = React.useState(0);

  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("listen");
  const [modelPos, setModelPos] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const [recPct, setRecPct] = React.useState(0);
  const [loop, setLoop] = React.useState(false);
  const loopRef = React.useRef(false);
  /** Repeticiones del bucle A–B: 3, 5, 10 o sin fin (§7). */
  const [loopTimes, setLoopTimes] = React.useState<number>(3);
  const loopTimesRef = React.useRef(3);
  const [loopsLeft, setLoopsLeft] = React.useState(0);
  const [textHidden, setTextHidden] = React.useState(false);
  const [takes, setTakes] = React.useState<Record<string, { url: string; blob: Blob; mime: string; dur: number }>>(
    {},
  );
  const [youAnalysis, setYouAnalysis] = React.useState<Analysis | null>(null);
  const [modelAnalysis, setModelAnalysis] = React.useState<Analysis | null>(null);
  const modelAnalysisRef = React.useRef<Analysis | null>(null);
  const duelRef = React.useRef(false);
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
  const videoRef = React.useRef<HTMLVideoElement>(null);
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
    // Con vídeo se usa el <video> del JSX, que sí está en el árbol y por
    // tanto se ve. Sin vídeo basta un <audio> suelto, sin nada que pintar.
    const el: HTMLMediaElement =
      showsVideo && videoRef.current
        ? videoRef.current
        : document.createElement("audio");
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
    rp.setLoop(loopRef.current, loopTimesRef.current);
    rp.onLoop((left) => setLoopsLeft(left));
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
      // El <video> lo posee React: se le quita la fuente en vez de tirarlo.
      if (el.tagName === "VIDEO") el.removeAttribute("src");
      playerRef.current = null;
      mediaElRef.current = null;
    };
  }, [file, media, showsVideo]);

  /* --- decodificar el recorte (una vez) --- */
  React.useEffect(() => {
    if (!file || !clip) return;
    let cancelled = false;
    setClipReady(false);
    setPeaksBusy(true);
    setPeaksNote(
      file.size > SLOW_DECODE_BYTES
        ? "Archivo grande: la primera onda puede tardar un minuto. Después queda guardada."
        : null,
    );
    (async () => {
      try {
        await ensureClipLoaded(
          file,
          isTts && round ? `${clip.id}_${round.id}` : clip.id,
          isTts ? 0 : clip.startSec,
          isTts ? Number.MAX_SAFE_INTEGER : clip.endSec,
          {
            // Códec que Web Audio no decodifica: se captura reproduciéndolo,
            // en tiempo real, así que hay que decirlo.
            onFallback: () =>
              setPeaksNote(
                "El audio de este archivo no se puede leer directamente, así que se está capturando mientras suena. Solo la primera vez.",
              ),
            onCaptureProgress: (cp) =>
              setPeaksNote(
                `Capturando el audio… ${Math.round(cp.elapsedSec)}s de ${Math.round(cp.totalSec)}s. Solo la primera vez.`,
              ),
          },
        );
        if (!cancelled) {
          setClipReady(true);
          setPeaksNote(null);
        }
      } catch (e) {
        if (!cancelled) {
          // Se muestra el error real: si un contenedor trae un códec de audio
          // que Web Audio no sabe decodificar, hay que poder saberlo.
          const detail = e instanceof Error ? e.message : String(e);
          setPeaksNote(
            e instanceof FileTooLargeToDecode
              ? "Archivo demasiado grande para analizarlo en el navegador."
              : `No se pudo leer el audio (${detail}). La reproducción y la grabación siguen funcionando.`,
          );
        }
      } finally {
        if (!cancelled) setPeaksBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, clip, isTts, round, peaksAttempt]);

  /**
   * Cortes afinados contra el audio.
   *
   * Los tiempos del .srt marcan cuándo entra y sale la línea en pantalla, no
   * cuándo empieza y acaba de sonar: el cue se cierra a menudo encima de la
   * última palabra. Se estiran hasta el primer silencio, y si no lo hay
   * —porque el siguiente hablante entra pisando— se queda un margen corto.
   */
  const [bounds, setBounds] = React.useState<{
    startSec: number;
    endSec: number;
  } | null>(null);

  React.useEffect(() => {
    setBounds(null);
    if (!round || !clip || !clipReady || isTts || isYouTube || !file) return;
    let cancelled = false;
    void refineRoundBounds(
      file,
      clip.id,
      clip.startSec,
      clip.endSec,
      round.startSec,
      round.endSec,
      { extraEndSec: phraseTailMs / 1000 },
    )
      .then((b) => {
        if (!cancelled) setBounds(b);
      })
      .catch(() => {
        /* sin afinar: se usan los tiempos del subtítulo */
      });
    return () => {
      cancelled = true;
    };
  }, [round, clip, clipReady, isTts, isYouTube, phraseTailMs, file]);

  /**
   * Tramo que suena de verdad: lo que hayas fijado a mano manda sobre el
   * afinado automático, y cada lado va por su cuenta.
   */
  const play = round ? effectiveBounds(round, bounds) : null;
  const playStart = play?.startSec ?? 0;
  const playEnd = play?.endSec ?? 0;

  /**
   * Tramos de las vecinas, para saber hasta dónde se puede correr la
   * frontera. Se usa lo manual si lo hay y, si no, el tiempo del subtítulo:
   * el afinado automático de la vecina no está calculado aquí y solo estira,
   * así que el subtítulo es el límite conservador. Como mucho, el botón se
   * deshabilita un cuarto de segundo antes de lo estrictamente necesario.
   */
  const prevBounds = React.useMemo(() => {
    const r = rounds?.[idx - 1];
    return r ? effectiveBounds(r, null) : null;
  }, [rounds, idx]);
  const nextBounds = React.useMemo(() => {
    const r = rounds?.[idx + 1];
    return r ? effectiveBounds(r, null) : null;
  }, [rounds, idx]);

  /** Aplica un movimiento de frontera a esta ronda y a la vecina. */
  const applyNudge = React.useCallback(
    (side: "start" | "end", plan: NudgePlan) => {
      if (!round) return;
      const neighbour = rounds?.[side === "start" ? idx - 1 : idx + 1];
      void setRoundBounds([
        { id: round.id, patch: plan.self },
        ...(plan.neighbour && neighbour
          ? [{ id: neighbour.id, patch: plan.neighbour }]
          : []),
      ]);
    },
    [round, rounds, idx],
  );

  /**
   * Vuelve al automático. De las vecinas solo se limpia el lado que da a esta
   * ronda: el otro puede haberlo ajustado el usuario por su cuenta.
   */
  const resetBounds = React.useCallback(() => {
    if (!round) return;
    const before = rounds?.[idx - 1];
    const after = rounds?.[idx + 1];
    void setRoundBounds([
      { id: round.id, patch: CLEAR_BOUNDS },
      ...(before ? [{ id: before.id, patch: { manualEndSec: undefined } }] : []),
      ...(after ? [{ id: after.id, patch: { manualStartSec: undefined } }] : []),
    ]);
  }, [round, rounds, idx]);

  /* --- rango del RangePlayer para la ronda actual --- */
  React.useEffect(() => {
    loopRef.current = loop;
    loopTimesRef.current = loopTimes;
    setLoopsLeft(loop ? loopTimes : 0);
    if (!round) return;
    desiredRangeRef.current = isTts
      ? [0, Number.MAX_SAFE_INTEGER]
      : [playStart, playEnd];
    if (!playerRef.current) return;
    // En TTS cada ronda es su propio archivo: el rango es todo el blob.
    const range: [number, number] = isTts
      ? [0, Number.MAX_SAFE_INTEGER]
      : [playStart, playEnd];
    desiredRangeRef.current = range;
    playerRef.current.setRange(range[0], range[1]);
    playerRef.current.setLoop(loop, loopTimes);
    setPhase("listen");
    setRecPct(0);
    setYouAnalysis(null);
    setRoundScore(null);
  }, [round, loop, loopTimes, isTts]);

  /**
   * Los cortes afinados llegan después de decodificar, así que se re-aplican
   * aparte: si esto fuera al efecto de arriba, cada afinado reiniciaría la
   * fase y te sacaría de la grabación.
   */
  React.useEffect(() => {
    if (isTts || !round || !playerRef.current) return;
    desiredRangeRef.current = [playStart, playEnd];
    playerRef.current.setRange(playStart, playEnd);
  }, [playStart, playEnd, isTts, round]);

  /* --- análisis del modelo de la ronda (F0 + energía), cacheado --- */
  React.useEffect(() => {
    if (!file || !round) return;
    let cancelled = false;
    setModelAnalysis(null);
    modelAnalysisRef.current = null;
    (async () => {
      try {
        const a = await roundAnalysis(
          file,
          isTts && round ? `${clip!.id}_${round.id}` : clip!.id,
          isTts ? 0 : clip!.startSec,
          isTts ? Number.MAX_SAFE_INTEGER : clip!.endSec,
          round.id,
          isTts ? 0 : playStart,
          isTts ? Number.MAX_SAFE_INTEGER : playEnd,
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
  }, [file, round, isTts, clip, playStart, playEnd]);

  // Al salir de la práctica se suelta el PCM que el worker tiene en memoria.
  React.useEffect(() => () => releaseClip(), []);

  /* --- primera visita: ¿auriculares? --- */
  React.useEffect(() => {
    if (usesHeadphones === null) setShowHeadphones(true);
  }, [usesHeadphones]);

  // Duración de la ronda: en TTS la del propio audio, si no la del rango.
  const roundDurationSec =
    modelAnalysis?.durationSec ?? (round ? playEnd - playStart : 0);
  const progressSec = modelPos * roundDurationSec;

  const modelContour = React.useMemo(
    () => (modelAnalysis ? contourForDisplay(modelAnalysis.semitones) : null),
    [modelAnalysis],
  );
  const youContour = React.useMemo(
    () => (youAnalysis ? contourForDisplay(youAnalysis.semitones) : null),
    [youAnalysis],
  );

  /**
   * La onda del modelo sale del análisis de ESTA ronda, no de trocear los
   * picos del recorte entero.
   *
   * Antes se calculaban 800 columnas para todo el recorte y la ronda se
   * quedaba con su trozo: la resolución era la del recorte, no la de la
   * ronda. En un recorte de 22 minutos cada columna dura 1,65 s, así que una
   * ronda de 3 s se dibujaba con dos columnas y los bordes, redondeados a
   * columna entera, la desplazaban hasta un segundo. La onda no correspondía
   * con lo que se veía en el vídeo, mientras la curva de entonación —que sí
   * salía del análisis de la ronda— caía en su sitio.
   */
  const roundPeaks = modelAnalysis?.peaks ?? null;

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
    const targetMs = Math.max(1200, (playEnd - playStart) * 1000);
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
          // El Duelo de curvas puntúa solo la entonación (§7.E).
          only: duelRef.current ? ["intonation"] : undefined,
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
        completedLaps: (practice?.completedLaps ?? 0) + 1,
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

  // Hasta ahora `practice.mode` no se leía nunca: todas las prácticas se
  // comportaban como Shadowing Eco. Aquí empieza a ramificar de verdad.
  const isCurveDuel = practice.mode === "curve-duel";
  duelRef.current = isCurveDuel;

  const showTextMode = practice.showText;
  // Escalera de texto (§7.A): la vuelta 1 muestra el texto entero, la 2 al
  // 40 %, la 3 lo oculta. Va por VUELTA, no por ronda: antes se atenuaba ya
  // en la segunda ronda de la primera pasada y parecía texto desactivado.
  const lap = practice.completedLaps ?? 0;
  const textOpacity =
    textHidden || showTextMode === "never"
      ? 0
      : showTextMode === "fade"
        ? lap >= 2
          ? 0
          : lap === 1
            ? 0.4
            : 1
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
              {showTextMode === "fade" && lap > 0 && (
                <p className="mt-1 text-xs font-semibold text-ink-soft">
                  Vuelta {lap + 1} ·{" "}
                  {lap === 1
                    ? "el texto se atenúa a propósito, para pasar del ojo al oído"
                    : "sin texto: ya deberías poder seguirlo de oído"}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setSetting("karaoke", !karaoke)}
                aria-pressed={karaoke}
                title="Resalta el texto a medida que suena"
                className={
                  karaoke
                    ? "rounded-lg border-2 border-ink bg-panel px-3 py-1.5 text-sm font-bold text-ink"
                    : "rounded-lg border-2 border-line-strong bg-surface px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
                }
              >
                Karaoke
              </button>
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
              karaoke={karaoke}
              progressSec={progressSec}
              durationSec={roundDurationSec}
              energy={modelAnalysis?.energy ?? null}
              energyHopSec={modelAnalysis?.energyHopSec}
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

        {/* El vídeo se mantiene visible al grabar: en shadowing ayuda a
            seguir la boca y el gesto del hablante. */}
        {showsVideo && !isCurveDuel && (
          <video
            ref={videoRef}
            playsInline
            className="aspect-video w-full rounded-xl bg-panel object-contain"
            aria-label="Vídeo del recorte"
          />
        )}

        <div className="space-y-3" hidden={isYouTube || isCurveDuel}>
          <WaveformPanel
            label="Modelo"
            peaks={roundPeaks}
            contour={modelContour}
            progress={modelPos}
            durationSec={roundDurationSec}
            onSeek={(r) => {
              // Pinchar en la onda reproduce desde ese punto: útil para
              // repetir una palabra suelta que no se ha entendido.
              if (isYouTube) {
                ytRef.current?.play(false);
                return;
              }
              ensureAudioContext();
              void playerRef.current?.seekRatio(r);
            }}
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
          {peaksBusy && (
            <p className="text-xs font-semibold text-ink-soft">
              Generando la forma de onda…
            </p>
          )}
          {peaksNote && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-ink-soft">{peaksNote}</p>
              {!peaksBusy && !clipReady && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setPeaksAttempt((n) => n + 1)}
                >
                  Reintentar
                </Button>
              )}
            </div>
          )}
        </div>

        {!isTts && round && clip && play && (
          <BoundsControl
            self={play}
            prev={prevBounds}
            next={nextBounds}
            clip={{ startSec: clip.startSec, endSec: clip.endSec }}
            manual={hasManualBounds(round)}
            stepSec={phraseNudgeSec}
            onStepChange={(v) => setSetting("phraseNudgeSec", v)}
            onNudge={applyNudge}
            onReset={resetBounds}
          />
        )}

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
            <Countdown
              label={
                isCurveDuel ? "Sigue la forma de la curva" : "Sigue al modelo"
              }
              onDone={() => void beginRecording()}
            />
          )}

          {isCurveDuel && phase !== "countdown" && (
            <CurveDuel
              modelAnalysis={modelAnalysis}
              takeAnalysis={youAnalysis}
              phase={
                phase === "recording"
                  ? "recording"
                  : phase === "compare"
                    ? "result"
                    : "study"
              }
              scoring={scoring}
              recPct={recPct}
              isLast={idx + 1 >= total}
              onRecord={startCountdown}
              onStop={() => void stopRecording()}
              onRetry={startCountdown}
              onNext={() => void saveAndContinue()}
              onRevealAudio={() => playModel(true)}
            />
          )}

          {!isCurveDuel && phase === "listen" && (
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
                  variant={loop ? "default" : "outline"}
                  onClick={() => setLoop((v) => !v)}
                  aria-pressed={loop}
                >
                  {loop
                    ? loopsLeft === Infinity
                      ? "Bucle ∞"
                      : `Bucle ×${loopsLeft}`
                    : "Bucle A–B"}
                </Button>
                {loop && (
                  <div
                    className="col-span-2 flex flex-wrap items-center gap-1"
                    role="group"
                    aria-label="Repeticiones del bucle"
                  >
                    <span className="mr-1 text-xs font-bold text-ink-soft">
                      Repetir
                    </span>
                    {[3, 5, 10, Infinity].map((n) => (
                      <Button
                        key={String(n)}
                        size="xs"
                        variant={loopTimes === n ? "default" : "outline"}
                        aria-pressed={loopTimes === n}
                        onClick={() => setLoopTimes(n)}
                      >
                        {n === Infinity ? "∞" : `×${n}`}
                      </Button>
                    ))}
                  </div>
                )}
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

          {!isCurveDuel && phase === "recording" && (
            <Button
              variant="record"
             
              className="w-full h-16 text-lg"
              onClick={() => void stopRecording()}
            >
              ■ Detener ({Math.round(recPct * 100)}%)
            </Button>
          )}

          {!isCurveDuel && phase === "compare" && (
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
              {round ? `${fmtClock(playStart)}–${fmtClock(playEnd)}` : ""}
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
