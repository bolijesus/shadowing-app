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
