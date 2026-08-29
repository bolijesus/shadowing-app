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
import {
  appendRound,
  countTakesOf,
  deleteRoundCascade,
  mergeRoundWithNext,
  splitRound,
} from "@/lib/db/repositories";
import { estimateSpokenSec, splitScript } from "@/lib/text/splitScript";
import { ttsProvider } from "@/lib/tts/providers";
import { styleById, type TtsProviderId } from "@/lib/tts/types";
import { readAsObjectURL } from "@/lib/storage/opfs";
import { useConfirm } from "@/components/ui/confirm";
import { OfflineStatus } from "@/components/practice/OfflineStatus";
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
  const [cached, setCached] = React.useState<Record<string, boolean>>({});
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkText, setBulkText] = React.useState("");
  const [splitting, setSplitting] = React.useState<string | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const [queueRunning, setQueueRunning] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const isTts = media?.source.kind === "tts";
  const language = media?.language ?? "en-US";

  React.useEffect(() => {
    if (!practice || !rounds) return;
    // Se mezcla en lugar de sobrescribir: al añadir o quitar una ronda este
    // efecto vuelve a correr, y reemplazar borraría lo que estés escribiendo.
    setOrder((prev) => {
      const known = new Set(practice.roundIds);
      const kept = prev.filter((rid) => known.has(rid));
      const added = practice.roundIds.filter((rid) => !kept.includes(rid));
      return [...kept, ...added];
    });
    setTexts((prev) => {
      const next = { ...prev };
      for (const r of rounds) if (!(r.id in next)) next[r.id] = r.text;
      for (const key of Object.keys(next)) {
        if (!rounds.some((r) => r.id === key)) delete next[key];
      }
      return next;
    });
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
    // Hereda la voz ya usada, para no volver a "Voz del navegador" al entrar.
    const saved = rounds.find((r) => r.ttsProvider);
    if (saved) {
      setGlobalVoice((g) =>
        g.provider === DEFAULT_VOICE.provider && !g.voice
          ? {
              provider: saved.ttsProvider as TtsProviderId,
              voice: saved.ttsVoice ?? "",
              style: saved.ttsStyle ?? DEFAULT_VOICE.style,
              rate: DEFAULT_VOICE.rate,
            }
          : g,
      );
    }
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
  const remove = async (rid: string) => {
    if (order.length <= 1) return; // una práctica necesita al menos una ronda
    setOrder((o) => o.filter((x) => x !== rid));
    await deleteRoundCascade(id, rid);
  };

  const setVoiceFor = (rid: string, v: VoiceSelection) => {
    const prev = voices[rid];
    const changed =
      !!prev &&
      (prev.provider !== v.provider ||
        prev.voice !== v.voice ||
        prev.style !== v.style);
    setVoices((s) => ({ ...s, [rid]: v }));
    // Solo invalida el audio si la voz cambió de verdad. El selector fija
    // una voz por defecto al montar, y eso no debe marcar "sin preparar".
    if (changed) setPrep((s) => ({ ...s, [rid]: "idle" }));
  };

  async function prepareOne(rid: string) {
    const round = byId.get(rid);
    if (!round) return;
    const text = texts[rid] ?? round.text;
    setPrep((s) => ({ ...s, [rid]: "pending" }));
    setErrors((e) => ({ ...e, [rid]: "" }));
    try {
      await db().rounds.update(rid, { text });
      const res = await prepareRound(
        { ...round, text },
        voices[rid] ?? globalVoice,
        language,
      );
      setPrep((s) => ({ ...s, [rid]: "ready" }));
      setCached((c) => ({ ...c, [rid]: res.fromCache }));
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

  /** Pide permiso si la operación va a tirar grabaciones. */
  async function okToDiscardTakes(roundIds: string[]): Promise<boolean> {
    const n = await countTakesOf(roundIds);
    if (n === 0) return true;
    return confirm({
      title: "Se perderán grabaciones",
      body: `Al cambiar el texto y el rango de la ronda, ${n} ${
        n === 1 ? "toma grabada deja" : "tomas grabadas dejan"
      } de corresponder y se ${n === 1 ? "borrará" : "borrarán"}.`,
      confirmLabel: "Continuar",
      tone: "danger",
    });
  }

  async function mergeWithNext(rid: string) {
    const i = order.indexOf(rid);
    const next = order[i + 1];
    if (!next) return;
    if (!(await okToDiscardTakes([rid, next]))) return;
    await mergeRoundWithNext(id, rid);
    setOrder((o) => o.filter((x) => x !== next));
    setPrep((s) => ({ ...s, [rid]: "idle" }));
  }

  async function doSplit(rid: string, atWord: number) {
    if (!(await okToDiscardTakes([rid]))) return;
    await splitRound(id, rid, atWord);
    setSplitting(null);
    setPrep((s) => ({ ...s, [rid]: "idle" }));
  }

  async function addOne(text = "") {
    const r = await appendRound(id, {
      text,
      durationSec: text ? estimateSpokenSec(text) : 3,
    });
    if (r) {
      setOrder((o) => [...o, r.id]);
      setTexts((t) => ({ ...t, [r.id]: text }));
      setVoices((v) => ({ ...v, [r.id]: { ...globalVoice } }));
      setPrep((pr) => ({ ...pr, [r.id]: "idle" }));
    }
  }

  async function addFromText() {
    const lines = splitScript(bulkText);
    if (!lines.length) return;
    for (const l of lines) await addOne(l.text);
    setBulkText("");
    setBulkOpen(false);
  }

  const save = async () => {
    // Si el estado local aún no está poblado, no se toca nada: escribir
    // `?? ""` aquí borraría el texto de las rondas.
    if (!order.length) {
      router.push(`/practica/${id}`);
      return;
    }
    await db().transaction("rw", db().practices, db().rounds, async () => {
      await db().practices.update(id, { roundIds: order });
      await Promise.all(
        order.map((rid, index) => {
          const text = texts[rid] ?? byId.get(rid)?.text ?? "";
          return db().rounds.update(rid, { index, text });
        }),
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

          <OfflineStatus rounds={rounds ?? []} />

          <VoicePicker
            value={globalVoice}
            onChange={(v) => {
              const changed =
                globalVoice.provider !== v.provider ||
                globalVoice.voice !== v.voice ||
                globalVoice.style !== v.style;
              setGlobalVoice(v);
              if (!changed) return;
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
                      {/* El tramo ajustado a mano, si lo hay. El afinado
                          automático no se calcula aquí: necesita el audio
                          decodificado y esta pantalla no lo abre. */}
                      {fmtClock(r.manualStartSec ?? r.startSec)}–
                      {fmtClock(r.manualEndSec ?? r.endSec)}
                      {(r.manualStartSec !== undefined ||
                        r.manualEndSec !== undefined) && (
                        <span className="ml-1 not-italic">· a mano</span>
                      )}
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void mergeWithNext(rid)}
                    disabled={i === order.length - 1}
                    title="Junta esta ronda con la siguiente"
                  >
                    Unir
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSplitting(splitting === rid ? null : rid)
                    }
                    aria-expanded={splitting === rid}
                    disabled={(texts[rid] ?? "").split(/\s+/).filter(Boolean).length < 2}
                    title="Parte esta ronda en dos"
                  >
                    Partir
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void remove(rid)}
                    disabled={order.length <= 1}
                    title={
                      order.length <= 1
                        ? "Una práctica necesita al menos una ronda"
                        : undefined
                    }
                  >
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

              {splitting === rid && (
                <div className="mt-3 rounded-lg border-2 border-line bg-panel p-3">
                  <p className="mb-2 text-sm font-bold">
                    ¿Dónde parto la ronda?
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(texts[rid] ?? "")
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((w, wi, arr) =>
                        wi === 0 ? null : (
                          <button
                            key={`${w}-${wi}`}
                            onClick={() => void doSplit(rid, wi)}
                            title={`Cortar antes de «${w}»`}
                            className="rounded border-2 border-line-strong bg-surface px-2 py-1 text-xs font-semibold text-ink hover:border-brand hover:text-brand-ink"
                          >
                            ⏐ {w}
                            {wi === arr.length - 1 ? "" : "…"}
                          </button>
                        ),
                      )}
                  </div>
                  <p className="mt-2 text-xs text-ink-soft">
                    El corte va antes de la palabra que elijas. El tiempo se
                    reparte según la longitud de cada mitad.
                  </p>
                </div>
              )}

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
                    {cached[rid] && " · ya estaba descargada, sin llamada a la API"}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void addOne()}>
            + Añadir ronda
          </Button>
          <Button
            variant="outline"
            onClick={() => setBulkOpen((v) => !v)}
            aria-expanded={bulkOpen}
          >
            Añadir varias desde texto
          </Button>
          <span className="text-sm text-ink-soft">
            {order.length} {order.length === 1 ? "ronda" : "rondas"}
          </span>
        </div>

        {bulkOpen && (
          <div className="space-y-2">
            <Textarea
              aria-label="Frases nuevas"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={4}
              placeholder={"Una frase por línea.\nCada línea será una ronda nueva."}
            />
            <div className="flex gap-2">
              <Button onClick={() => void addFromText()} disabled={!bulkText.trim()}>
                Añadir {splitScript(bulkText).length || ""} rondas
              </Button>
              <Button variant="ghost" onClick={() => setBulkOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="sticky bottom-20 flex flex-wrap items-center gap-2 sm:bottom-4">
        {/* Generar una voz ya persiste la ronda, así que este botón nunca
            se bloquea: guarda orden y textos (idempotente) y sigue. */}
        <Button onClick={save}>Guardar y practicar →</Button>
        <Link href={`/practica/${id}`}>
          <Button variant="outline">Practicar sin guardar</Button>
        </Link>
        {confirmNode}
        {dirty && (
          <span className="text-xs font-semibold text-brand-ink">
            Tienes cambios sin guardar
          </span>
        )}
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
      onClick={() => url && void new Audio(url).play().catch(() => {})}
    >
      Escuchar
    </Button>
  );
}
