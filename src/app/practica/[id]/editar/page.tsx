"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { MediaItem, Round, ShowText } from "@/lib/types";
import {
  Button,
  Card,
  Eyebrow,
  Pill,
  SelectField,
} from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import {
  VoicePicker,
  DEFAULT_VOICE,
  type VoiceSelection,
} from "@/components/nueva/VoicePicker";
import { prepareAll, prepareRound, type PrepState } from "@/lib/tts/queue";
import { ttsProvider } from "@/lib/tts/providers";
import { styleById, type TtsProviderId } from "@/lib/tts/types";
import { readAsObjectURL } from "@/lib/storage/opfs";
import { fmtClock } from "@/lib/util";

export default function EditPracticePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const practice = useLiveQuery(() => db().practices.get(id), [id]);
  const clip = useLiveQuery(
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

  const [order, setOrder] = React.useState<string[]>([]);
  const [texts, setTexts] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const [voices, setVoices] = React.useState<Record<string, VoiceSelection>>({});
  const [globalVoice, setGlobalVoice] =
    React.useState<VoiceSelection>(DEFAULT_VOICE);
  const [prep, setPrep] = React.useState<Record<string, PrepState>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [queueRunning, setQueueRunning] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const isTts = media?.source.kind === "tts";
  const language = media?.language ?? "en-US";

  React.useEffect(() => {
    if (!practice || !rounds) return;
    setOrder(practice.roundIds);
    setTexts(Object.fromEntries(rounds.map((r) => [r.id, r.text])));
    setVoices((prev) => {
      const next = { ...prev };
      for (const r of rounds) {
        if (next[r.id]) continue;
        next[r.id] = {
          provider: (r.ttsProvider as TtsProviderId) ?? DEFAULT_VOICE.provider,
          voice: r.ttsVoice ?? DEFAULT_VOICE.voice,
          style: r.ttsStyle ?? DEFAULT_VOICE.style,
          rate: DEFAULT_VOICE.rate,
        };
      }
      return next;
    });
    setPrep((prev) => {
      const next = { ...prev };
      for (const r of rounds) {
        if (!next[r.id]) next[r.id] = r.modelAudioRef ? "ready" : "idle";
      }
      return next;
    });
  }, [practice?.id, rounds?.length]);

  if (!practice) {
    return (
      <p className="p-8 text-center text-ink-soft">Esta práctica ya no existe.</p>
    );
  }

  const byId = new Map((rounds ?? []).map((r) => [r.id, r]));
  const readyCount = order.filter((rid) => prep[rid] === "ready").length;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    setDirty(true);
  };
  const remove = (rid: string) => {
    setOrder((o) => o.filter((x) => x !== rid));
    setDirty(true);
  };

  const setVoiceFor = (rid: string, v: VoiceSelection) => {
    setVoices((s) => ({ ...s, [rid]: v }));
    // Cambiar la voz invalida el audio ya preparado.
    setPrep((s) => ({ ...s, [rid]: "idle" }));
  };

  async function prepareOne(rid: string) {
    const round = byId.get(rid);
    if (!round) return;
    const text = texts[rid] ?? round.text;
    setPrep((s) => ({ ...s, [rid]: "pending" }));
    setErrors((e) => ({ ...e, [rid]: "" }));
    try {
      await db().rounds.update(rid, { text });
      await prepareRound(
        { ...round, text },
        voices[rid] ?? globalVoice,
        language,
      );
      setPrep((s) => ({ ...s, [rid]: "ready" }));
    } catch (e) {
      setPrep((s) => ({ ...s, [rid]: "error" }));
      setErrors((er) => ({
        ...er,
        [rid]: e instanceof Error ? e.message : "No se pudo generar la voz.",
      }));
    }
  }

  async function prepareEverything() {
    const list = order
      .map((rid) => byId.get(rid))
      .filter((r): r is Round => !!r);
    if (!list.length) return;
    setQueueRunning(true);
    abortRef.current = new AbortController();
    await Promise.all(
      list.map((r) => db().rounds.update(r.id, { text: texts[r.id] ?? r.text })),
    );
    await prepareAll(
      list.map((r) => ({ ...r, text: texts[r.id] ?? r.text })),
      (r) => voices[r.id] ?? globalVoice,
      language,
      (p) => {
        setPrep((s) => ({ ...s, [p.roundId]: p.state }));
        if (p.error) setErrors((e) => ({ ...e, [p.roundId]: p.error! }));
      },
      abortRef.current.signal,
    );
    setQueueRunning(false);
  }

  const save = async () => {
    await db().transaction("rw", db().practices, db().rounds, async () => {
      await db().practices.update(id, { roundIds: order });
      await Promise.all(
        order.map((rid, index) =>
          db().rounds.update(rid, { index, text: texts[rid] ?? "" }),
        ),
      );
    });
    setDirty(false);
    router.push(`/practica/${id}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Editor</Eyebrow>
          <h1 className="h-display mt-1 text-2xl">{practice.title}</h1>
        </div>
        <Link href={`/practica/${id}`}>
          <Button variant="ghost">Probar como estudiante →</Button>
        </Link>
      </div>

      <Card className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold">Mostrar el texto</span>
        <SelectField
          aria-label="Mostrar el texto"
          value={practice.showText}
          onValueChange={(v) =>
            db().practices.update(id, { showText: v as ShowText })
          }
          className="max-w-[240px]"
          options={[
            { value: "always", label: "Siempre" },
            { value: "fade", label: "Escalera" },
            { value: "never", label: "Nunca" },
          ]}
        />
      </Card>

      {isTts && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold">Voz para todas las rondas</p>
              <p className="text-sm text-ink-soft">
                Puedes cambiarla ronda a ronda más abajo.
              </p>
            </div>
            <Pill tone={readyCount === order.length ? "ok" : "neutral"}>
              {readyCount} de {order.length} listas
            </Pill>
          </div>

          <VoicePicker
            value={globalVoice}
            onChange={(v) => {
              setGlobalVoice(v);
              setVoices((s) => {
                const next = { ...s };
                for (const rid of order) next[rid] = { ...v };
                return next;
              });
              setPrep((s) => {
                const next = { ...s };
                for (const rid of order) next[rid] = "idle";
                return next;
              });
            }}
            language={language}
          />

          {!ttsProvider(globalVoice.provider).producesAudio && (
            <p className="rounded-lg border-l-4 border-brand bg-brand-tint px-4 py-3 text-sm text-ink">
              La voz del navegador no entrega el audio, solo lo reproduce: no se
              puede preparar ni analizar. Elige otro proveedor en Ajustes para
              tener onda y nota del modelo.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={prepareEverything}
              disabled={
                queueRunning || !ttsProvider(globalVoice.provider).producesAudio
              }
            >
              {queueRunning ? "Preparando…" : "Preparar todas las voces"}
            </Button>
            {queueRunning && (
              <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                Detener
              </Button>
            )}
          </div>
        </Card>
      )}

      <ol className="space-y-3">
        {order.map((rid, i) => {
          const r = byId.get(rid);
          if (!r) return null;
          return (
            <li key={rid} className="rounded-xl border-2 border-line bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  Ronda {i + 1}
                  {!isTts && (
                    <span className="ml-2 font-mono text-xs font-normal text-ink-soft">
                      {fmtClock(r.startSec)}–{fmtClock(r.endSec)}
                    </span>
                  )}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => move(i, -1)}>
                    Subir
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => move(i, 1)}>
                    Bajar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => remove(rid)}>
                    Quitar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-bold">Texto</span>
                <Textarea
                  aria-label={`Texto de la ronda ${i + 1}`}
                  value={texts[rid] ?? ""}
                  onChange={(e) => {
                    setTexts((t) => ({ ...t, [rid]: e.target.value }));
                    setDirty(true);
                    setPrep((s) => ({ ...s, [rid]: "idle" }));
                  }}
                  rows={2}
                />
              </div>

              {isTts && (
                <>
                  <div className="mt-3">
                    <VoicePicker
                      compact
                      value={voices[rid] ?? globalVoice}
                      onChange={(v) => setVoiceFor(rid, v)}
                      language={language}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <PrepPill state={prep[rid] ?? "idle"} />
                    <div className="flex gap-2">
                      {prep[rid] === "ready" && r.modelAudioRef && (
                        <PlayGenerated path={r.modelAudioRef} />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void prepareOne(rid)}
                        disabled={
                          prep[rid] === "pending" ||
                          queueRunning ||
                          !ttsProvider((voices[rid] ?? globalVoice).provider)
                            .producesAudio
                        }
                      >
                        Generar voz
                      </Button>
                    </div>
                  </div>

                  {errors[rid] && (
                    <p className="mt-2 text-sm font-medium text-brand-ink">
                      {errors[rid]}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-ink-soft">
                    {styleById((voices[rid] ?? globalVoice).style).label}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-20 flex gap-2 sm:bottom-4">
        <Button onClick={save} disabled={!dirty}>
          Guardar cambios
        </Button>
        <Link href={`/practica/${id}`}>
          <Button variant="outline">Descartar</Button>
        </Link>
      </div>
    </div>
  );
}

function PrepPill({ state }: { state: PrepState }) {
  if (state === "ready") return <Pill tone="ok">Lista</Pill>;
  if (state === "pending") return <Pill tone="data">Preparando…</Pill>;
  if (state === "error") return <Pill tone="brand">Error</Pill>;
  return <Pill>Sin preparar</Pill>;
}

function PlayGenerated({ path }: { path: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let made: string | null = null;
    readAsObjectURL(path, "audio/wav")
      .then((u) => {
        made = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!url}
      onClick={() => url && void new Audio(url).play()}
    >
      Escuchar
    </Button>
  );
}
