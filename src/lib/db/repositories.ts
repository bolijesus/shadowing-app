"use client";

import { db } from "./db";
import type {
  Clip,
  MediaItem,
  Practice,
  PracticeMode,
  Round,
  ShowText,
  Source,
  Take,
  Transcript,
  TranscriptOrigin,
} from "@/lib/types";
import type { Cue } from "@/lib/types";
import type { RoundSeed } from "@/lib/subtitles/segmentation";
import { uid } from "@/lib/util";
import { deleteBlob, deleteBlobsByOwner } from "@/lib/storage/blobStore";
import { removeBlob } from "@/lib/storage/opfs";

export async function createMedia(input: {
  title: string;
  language: string;
  source: Source;
  durationSec: number;
  hasVideo: boolean;
}): Promise<MediaItem> {
  const media: MediaItem = {
    id: uid("m"),
    createdAt: Date.now(),
    ...input,
  };
  await db().media.put(media);
  return media;
}

export async function createTranscript(
  mediaId: string,
  origin: TranscriptOrigin,
  cues: Cue[],
): Promise<Transcript> {
  const t: Transcript = { id: uid("t"), mediaId, origin, cues };
  await db().transcripts.put(t);
  await db().media.update(mediaId, { transcriptId: t.id });
  return t;
}

export async function createClip(
  mediaId: string,
  startSec: number,
  endSec: number,
  title: string,
): Promise<Clip> {
  const clip: Clip = {
    id: uid("c"),
    mediaId,
    startSec,
    endSec,
    title,
    createdAt: Date.now(),
  };
  await db().clips.put(clip);
  return clip;
}

export async function createRounds(
  clipId: string,
  seeds: RoundSeed[],
): Promise<Round[]> {
  const rounds: Round[] = seeds.map((s) => ({
    id: uid("r"),
    clipId,
    index: s.index,
    startSec: s.startSec,
    endSec: s.endSec,
    text: s.text,
  }));
  await db().rounds.bulkPut(rounds);
  return rounds;
}

/**
 * Añade una ronda al final de una práctica. En prácticas de voz IA los
 * tiempos son virtuales (cada ronda es su propio audio); en las de archivo
 * se abre una ventana después de la última, sin salirse del recorte.
 */
export async function appendRound(
  practiceId: string,
  opts: { text?: string; durationSec?: number } = {},
): Promise<Round | null> {
  const practice = await db().practices.get(practiceId);
  if (!practice) return null;
  const clip = await db().clips.get(practice.clipId);
  if (!clip) return null;

  const existing = await db()
    .rounds.where("clipId")
    .equals(clip.id)
    .toArray();
  const lastEnd = existing.length
    ? Math.max(...existing.map((r) => r.endSec))
    : clip.startSec;

  const dur = opts.durationSec ?? 3;
  const startSec = Math.min(lastEnd + 0.3, clip.endSec);
  const endSec = Math.min(startSec + dur, Math.max(clip.endSec, startSec + dur));

  const round: Round = {
    id: uid("r"),
    clipId: clip.id,
    index: practice.roundIds.length,
    startSec,
    endSec,
    text: opts.text ?? "",
  };

  await db().transaction("rw", db().rounds, db().practices, async () => {
    await db().rounds.put(round);
    await db().practices.update(practiceId, {
      roundIds: [...practice.roundIds, round.id],
    });
  });
  return round;
}

/** Cuántas tomas se perderían al cambiar el rango de estas rondas. */
export async function countTakesOf(roundIds: string[]): Promise<number> {
  if (!roundIds.length) return 0;
  return db().takes.where("roundId").anyOf(roundIds).count();
}

/**
 * Une una ronda con la siguiente: extiende el rango, concatena el texto y
 * borra la segunda. Las tomas de ambas se pierden, porque una grabación
 * deja de corresponder a la ronda si cambia su texto y su rango.
 */
export async function mergeRoundWithNext(
  practiceId: string,
  roundId: string,
): Promise<boolean> {
  const practice = await db().practices.get(practiceId);
  if (!practice) return false;
  const i = practice.roundIds.indexOf(roundId);
  if (i === -1 || i === practice.roundIds.length - 1) return false;

  const nextId = practice.roundIds[i + 1]!;
  const [a, b] = await Promise.all([
    db().rounds.get(roundId),
    db().rounds.get(nextId),
  ]);
  if (!a || !b) return false;

  const takes = await db().takes.where("roundId").anyOf([roundId, nextId]).toArray();

  await db().transaction("rw", db().practices, db().rounds, db().takes, async () => {
    await db().rounds.update(roundId, {
      startSec: Math.min(a.startSec, b.startSec),
      endSec: Math.max(a.endSec, b.endSec),
      text: `${a.text} ${b.text}`.trim(),
      // El audio generado ya no vale: el texto ha cambiado.
      modelAudioRef: undefined,
      analysisRef: undefined,
    });
    await db().rounds.delete(nextId);
    await db().takes.bulkDelete(takes.map((t) => t.id));
    await db().practices.update(practiceId, {
      roundIds: practice.roundIds.filter((r) => r !== nextId),
    });
  });

  for (const t of takes) if (t.audioRef) await deleteBlob(t.audioRef);
  if (a.analysisRef) await deleteBlob(a.analysisRef);
  if (b.analysisRef) await deleteBlob(b.analysisRef);
  return true;
}

/**
 * Parte una ronda por la palabra indicada. El tiempo se reparte en
 * proporción a la longitud de cada mitad, que es el mismo criterio que usa
 * el karaoke para repartir palabras (`src/lib/text/wordTiming.ts`).
 */
export async function splitRound(
  practiceId: string,
  roundId: string,
  atWordIndex: number,
): Promise<boolean> {
  const practice = await db().practices.get(practiceId);
  const round = await db().rounds.get(roundId);
  if (!practice || !round) return false;

  const words = round.text.split(/\s+/).filter(Boolean);
  if (atWordIndex <= 0 || atWordIndex >= words.length) return false;

  const firstText = words.slice(0, atWordIndex).join(" ");
  const secondText = words.slice(atWordIndex).join(" ");
  const total = firstText.length + secondText.length || 1;
  const span = round.endSec - round.startSec;
  const cut = round.startSec + (span * firstText.length) / total;

  const takes = await db().takes.where("roundId").equals(roundId).toArray();
  const second: Round = {
    id: uid("r"),
    clipId: round.clipId,
    index: round.index + 1,
    startSec: cut,
    endSec: round.endSec,
    text: secondText,
    ttsProvider: round.ttsProvider,
    ttsVoice: round.ttsVoice,
    ttsStyle: round.ttsStyle,
  };

  const i = practice.roundIds.indexOf(roundId);
  const nextIds = [...practice.roundIds];
  nextIds.splice(i + 1, 0, second.id);

  await db().transaction("rw", db().practices, db().rounds, db().takes, async () => {
    await db().rounds.update(roundId, {
      endSec: cut,
      text: firstText,
      modelAudioRef: undefined,
      analysisRef: undefined,
    });
    await db().rounds.put(second);
    await db().takes.bulkDelete(takes.map((t) => t.id));
    await db().practices.update(practiceId, { roundIds: nextIds });
  });

  for (const t of takes) if (t.audioRef) await deleteBlob(t.audioRef);
  if (round.analysisRef) await deleteBlob(round.analysisRef);
  return true;
}

/** Quita una ronda de la práctica y borra sus tomas y audios. */
export async function deleteRoundCascade(
  practiceId: string,
  roundId: string,
): Promise<void> {
  const practice = await db().practices.get(practiceId);
  const round = await db().rounds.get(roundId);
  const takes = await db().takes.where("roundId").equals(roundId).toArray();

  await db().transaction("rw", db().practices, db().rounds, db().takes, async () => {
    if (practice) {
      await db().practices.update(practiceId, {
        roundIds: practice.roundIds.filter((r) => r !== roundId),
      });
    }
    await db().takes.bulkDelete(takes.map((t) => t.id));
    await db().rounds.delete(roundId);
  });

  for (const t of takes) if (t.audioRef) await deleteBlob(t.audioRef);
  // El audio TTS NO se borra: vive en la caché compartida por hash y puede
  // estar en uso por otra ronda o práctica con el mismo texto y voz.
  if (round?.analysisRef) await deleteBlob(round.analysisRef);
}

export async function createPractice(input: {
  title: string;
  clipId: string;
  mode: PracticeMode;
  roundIds: string[];
  showText: ShowText;
}): Promise<Practice> {
  const p: Practice = { id: uid("p"), createdAt: Date.now(), ...input };
  await db().practices.put(p);
  return p;
}

export async function saveTake(take: Take): Promise<void> {
  await db().takes.put(take);
}

export async function setTakeKept(takeId: string, kept: boolean): Promise<void> {
  await db().takes.update(takeId, { kept });
}

export async function deleteTake(takeId: string): Promise<void> {
  const take = await db().takes.get(takeId);
  await db().takes.delete(takeId);
  if (take?.audioRef) await deleteBlob(take.audioRef);
}

/* ---------- Borrado en cascada (fila primero, blob después) ---------- */

export async function deletePracticeCascade(practiceId: string): Promise<void> {
  const p = await db().practices.get(practiceId);
  if (!p) return;
  const takes = await db()
    .takes.where("roundId")
    .anyOf(p.roundIds)
    .toArray();
  await db().transaction("rw", db().practices, db().takes, async () => {
    await db().takes.bulkDelete(takes.map((t) => t.id));
    await db().practices.delete(practiceId);
  });
  for (const t of takes) if (t.audioRef) await deleteBlob(t.audioRef);
}

export async function deleteClipCascade(clipId: string): Promise<void> {
  const rounds = await db().rounds.where("clipId").equals(clipId).toArray();
  const roundIds = rounds.map((r) => r.id);
  const practices = await db().practices.where("clipId").equals(clipId).toArray();
  const takes = roundIds.length
    ? await db().takes.where("roundId").anyOf(roundIds).toArray()
    : [];

  await db().transaction(
    "rw",
    db().clips,
    db().rounds,
    db().practices,
    db().takes,
    async () => {
      await db().takes.bulkDelete(takes.map((t) => t.id));
      await db().practices.bulkDelete(practices.map((p) => p.id));
      await db().rounds.bulkDelete(roundIds);
      await db().clips.delete(clipId);
    },
  );

  for (const t of takes) if (t.audioRef) await deleteBlob(t.audioRef);
  for (const r of rounds) {
    if (r.modelAudioRef) await deleteBlob(r.modelAudioRef);
    if (r.analysisRef) await deleteBlob(r.analysisRef);
  }
  await removeBlob(`analysis/peaks_${clipId}.bin`);
  await db().blobs.delete(`analysis/peaks_${clipId}.bin`);
}

export async function deleteMediaCascade(mediaId: string): Promise<void> {
  const clips = await db().clips.where("mediaId").equals(mediaId).toArray();
  for (const c of clips) await deleteClipCascade(c.id);

  const transcripts = await db()
    .transcripts.where("mediaId")
    .equals(mediaId)
    .toArray();
  const media = await db().media.get(mediaId);

  await db().transaction("rw", db().media, db().transcripts, async () => {
    await db().transcripts.bulkDelete(transcripts.map((t) => t.id));
    await db().media.delete(mediaId);
  });

  await deleteBlobsByOwner(mediaId);
  if (media?.source.kind === "local-file" && media.source.handleId) {
    await db().fileHandles.delete(media.source.handleId);
  }
}

/* ---------- Acciones de almacenamiento en bloque (§10) ---------- */

export async function deleteRecordingsOlderThan(days: number): Promise<number> {
  const cutoff = Date.now() - days * 86400_000;
  const old = await db()
    .takes.where("createdAt")
    .below(cutoff)
    .toArray();
  await db().takes.bulkDelete(old.map((t) => t.id));
  for (const t of old) if (t.audioRef) await deleteBlob(t.audioRef);
  return old.length;
}

export async function deleteUnsavedTakes(): Promise<number> {
  const unsaved = await db().takes.filter((t) => !t.kept).toArray();
  await db().takes.bulkDelete(unsaved.map((t) => t.id));
  for (const t of unsaved) if (t.audioRef) await deleteBlob(t.audioRef);
  return unsaved.length;
}
