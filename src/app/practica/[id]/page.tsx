"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Clip, MediaItem, Practice, Round, Transcript } from "@/lib/types";
import { Button } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/Dialog";
import { Waveform } from "@/components/waveform/Waveform";
import { SegmentedProgress } from "@/components/practice/SegmentedProgress";
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
import { computePeaksFromBlob, getOrBuildPeaks } from "@/lib/audio/peaks";
import { FileTooLargeToDecode } from "@/lib/audio/decode";
import { speakWithBrowser, cancelBrowserSpeech } from "@/lib/tts/browser";
import type { Peaks } from "@/workers/audio-dsp.worker";
import { putBlob } from "@/lib/storage/blobStore";
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

  const [file, setFile] = React.useState<Blob | null>(null);
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
  const [recPct, setRecPct] = React.useState(0);
  const [loop, setLoop] = React.useState(false);
  const [textHidden, setTextHidden] = React.useState(false);
  const [takes, setTakes] = React.useState<Record<string, { url: string; blob: Blob; mime: string; dur: number }>>(
    {},
  );
  const [youPeaks, setYouPeaks] = React.useState<Peaks | null>(null);

  const [showHeadphones, setShowHeadphones] = React.useState(false);
  const [showMicExplain, setShowMicExplain] = React.useState(false);
  const micGranted = React.useRef(false);
  const pendingRecord = React.useRef(false);

  const mediaElRef = React.useRef<HTMLMediaElement | null>(null);
  const playerRef = React.useRef<RangePlayer | null>(null);
  const recorderRef = React.useRef<VoiceRecorder | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);

  const round = rounds?.[idx];
  const total = rounds?.length ?? 0;
  const doneFlags = React.useMemo(
    () => (rounds ?? []).map((r) => !!takes[r.id]),
    [rounds, takes],
  );

  /* --- resolver el archivo del medio --- */
  React.useEffect(() => {
    if (!media) return;
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
    rp.playbackRate = defaultRate;
    rp.onEnded(() => setPhase((p) => (p === "listen" ? "listen" : p)));
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
      URL.revokeObjectURL(url);
      playerRef.current = null;
      mediaElRef.current = null;
    };
  }, [file, media, defaultRate]);

  /* --- construir picos del recorte --- */
  React.useEffect(() => {
    if (!file || !clip) return;
    let cancelled = false;
    setPeaks(null);
    setPeaksNote(null);
    (async () => {
      try {
        const p = await getOrBuildPeaks({
          clipId: clip.id,
          file,
          startSec: clip.startSec,
          endSec: clip.endSec,
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
  }, [file, clip]);

  /* --- rango del RangePlayer para la ronda actual --- */
  React.useEffect(() => {
    if (!playerRef.current || !round) return;
    playerRef.current.setRange(round.startSec, round.endSec);
    playerRef.current.setLoop(loop);
    setPhase("listen");
    setRecPct(0);
    setYouPeaks(null);
  }, [round, loop]);

  /* --- primera visita: ¿auriculares? --- */
  React.useEffect(() => {
    if (usesHeadphones === null) setShowHeadphones(true);
  }, [usesHeadphones]);

  const roundPeaks = React.useMemo<Peaks | null>(() => {
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
  }, [peaks, clip, round]);

  function playModel(fromStart = true) {
    ensureAudioContext();
    void playerRef.current?.play(fromStart);
  }
  function pauseModel() {
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
    computePeaksFromBlob(result.blob)
      .then(setYouPeaks)
      .catch(() => setYouPeaks(null));
  }

  function playMine() {
    if (!round) return;
    const t = takes[round.id];
    if (!t) return;
    const a = new Audio(t.url);
    void a.play();
  }
  function playBoth() {
    playModel(true);
    playMine();
  }

  async function saveAndContinue() {
    if (!round) return;
    const t = takes[round.id];
    if (t) {
      const ext = extForMime(t.mime);
      const takeId = uid("tk");
      const path = `recordings/${takeId}.${ext}`;
      await putBlob(path, t.blob, "recording", takeId);
      await saveTake({
        id: takeId,
        roundId: round.id,
        createdAt: Date.now(),
        audioRef: path,
        mime: t.mime,
        durationSec: t.dur,
        latencyOffsetMs:
          useSettings.getState().micLatencyOffsetMs ?? defaultLatencyOffsetMs(),
        kept: true,
      });
    }
    if (idx + 1 < total) {
      setIdx(idx + 1);
    } else {
      await db().practices.update(practiceId, {
        lastPracticedAt: Date.now(),
      });
      router.push(`/resultados/${practiceId}`);
    }
  }

  useShortcuts(
    {
      playPause: () =>
        playerRef.current?.playing ? pauseModel() : playModel(false),
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
          className="rounded-control border-2 border-line-strong px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
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
        <div className="mx-4 mt-3 rounded-control border-2 border-accent bg-accent-tint px-4 py-3 text-sm text-accent-ink">
          {sourceIssue.kind === "permission" ? (
            <div className="space-y-2">
              <p>
                Se necesita permiso para volver a abrir{" "}
                <strong>{sourceIssue.fileName}</strong>.
              </p>
              <Button
                variant="secondary"
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
            <button
              onClick={() => setTextHidden((v) => !v)}
              className="shrink-0 rounded-control border-2 border-line-strong bg-surface px-3 py-1.5 text-sm font-bold text-ink hover:border-ink"
            >
              {textOpacity === 0 ? "Mostrar texto" : "Ocultar texto"}
            </button>
          </div>
          <div
            className="mt-3 rounded-card bg-panel p-5 transition-opacity"
            style={{ opacity: textOpacity || 0.001 }}
            aria-hidden={textOpacity === 0}
          >
            <p className="text-[22px] font-extrabold leading-snug text-ink">
              {round?.text || (
                <span className="text-ink-soft">
                  (sin texto para esta ronda)
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <Waveform
            peaks={roundPeaks}
            progress={modelPos}
            tone={
              phase === "recording"
                ? "recording"
                : playerRef.current?.playing
                  ? "playing"
                  : "reference"
            }
            label="Modelo"
            height={120}
          />
          {(phase === "compare" || youPeaks) && (
            <Waveform peaks={youPeaks} progress={0} label="Tú" height={96} />
          )}
          {peaksNote && <p className="text-xs text-ink-soft">{peaksNote}</p>}
          {phase === "recording" && <DotMeter value={recPct} />}
        </div>

        <div className="mt-auto space-y-3">
          {phase === "countdown" && (
            <Countdown onDone={() => void beginRecording()} />
          )}

          {phase === "listen" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    playerRef.current?.playing ? pauseModel() : playModel(true)
                  }
                  disabled={!file}
                >
                  {playerRef.current?.playing ? "Pausar" : "Escuchar modelo"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setLoop((v) => !v)}
                  aria-pressed={loop}
                >
                  {loop ? "Bucle: activado" : "Bucle A–B"}
                </Button>
                <Button
                  variant="secondary"
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
                full
                className="h-16 text-lg"
                onClick={startCountdown}
              >
                ● Grabar mi voz
              </Button>
            </>
          )}

          {phase === "recording" && (
            <Button
              variant="record"
              full
              className="h-16 text-lg"
              onClick={() => void stopRecording()}
            >
              ■ Detener ({Math.round(recPct * 100)}%)
            </Button>
          )}

          {phase === "compare" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => playModel(true)}>
                  Reproducir modelo
                </Button>
                <Button variant="secondary" onClick={playMine}>
                  Reproducir la mía
                </Button>
                <Button variant="secondary" onClick={playBoth}>
                  Reproducir juntas
                </Button>
                <Button variant="secondary" onClick={startCountdown}>
                  Grabar otra vez
                </Button>
              </div>
              <Button
                variant="primary"
                full
                className="h-14"
                onClick={() => void saveAndContinue()}
              >
                {idx + 1 < total
                  ? "Guardar toma y continuar"
                  : "Guardar y ver resumen"}
              </Button>
            </>
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

      <Dialog
        open={showHeadphones}
        onClose={() => {
          setSetting("usesHeadphones", false);
          setShowHeadphones(false);
        }}
        title="¿Estás usando auriculares?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setSetting("usesHeadphones", false);
                setShowHeadphones(false);
              }}
            >
              No
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setSetting("usesHeadphones", true);
                setShowHeadphones(false);
              }}
            >
              Sí, llevo auriculares
            </Button>
          </>
        }
      >
        Sin auriculares, el micrófono capta también el audio del modelo y las
        comparaciones dejan de tener sentido. Si llevas auriculares, se desactiva
        la cancelación de eco para analizar mejor tu voz.
      </Dialog>

      <Dialog
        open={showMicExplain}
        onClose={() => {
          setShowMicExplain(false);
          pendingRecord.current = false;
        }}
        title="Permiso de micrófono"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowMicExplain(false);
                pendingRecord.current = false;
              }}
            >
              Ahora no
            </Button>
            <Button
              variant="primary"
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
          </>
        }
      >
        La app pedirá acceso al micrófono para grabar tu voz. El audio se queda en
        este dispositivo: no se envía a ningún servidor.
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
    <div className="rounded-control border-2 border-ok/40 bg-ok/5 px-3 py-3">
      <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
        <span className="text-accent-ink">Grabando</span>
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
