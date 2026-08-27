"use client";

import {
  createClip,
  createMedia,
  createPractice,
  createRounds,
  createTranscript,
} from "@/lib/db/repositories";
import type { Cue, Practice, ShowText } from "@/lib/types";
import { splitScript, estimateSpokenSec } from "@/lib/text/splitScript";

/**
 * Crea una práctica a partir de texto (fuentes «Texto con voz IA» y
 * «Pegar guion»). El medio no tiene archivo: cada ronda lleva su propio
 * audio generado por TTS, que se prepara después en el editor.
 */
export async function createPracticeFromText(input: {
  title: string;
  language: string;
  script: string;
  showText: ShowText;
  voice: { provider: string; voice: string; style: string; rate: number };
}): Promise<Practice> {
  const lines = splitScript(input.script);
  if (!lines.length) throw new Error("El guion está vacío.");

  // Línea de tiempo virtual: cada frase ocupa su duración estimada.
  let t = 0;
  const spans = lines.map((l) => {
    const dur = estimateSpokenSec(l.text, input.voice.rate);
    const span = { start: t, end: t + dur, line: l };
    t += dur + 0.4; // pequeño respiro entre frases
    return span;
  });
  const totalSec = t;

  const media = await createMedia({
    title: input.title,
    language: input.language,
    source: {
      kind: "tts",
      generatedFrom: {
        provider: input.voice.provider as "browser",
        voice: input.voice.voice,
        style: input.voice.style,
        rate: input.voice.rate,
        text: input.script,
        language: input.language,
      },
    },
    durationSec: totalSec,
    hasVideo: false,
  });

  const cues: Cue[] = spans.map((s) => ({
    start: s.start,
    end: s.end,
    text: s.line.text,
    speaker: s.line.speaker,
  }));
  await createTranscript(media.id, "manual", cues);

  const clip = await createClip(media.id, 0, totalSec, input.title);

  const rounds = await createRounds(
    clip.id,
    spans.map((s, i) => ({
      index: i,
      startSec: s.start,
      endSec: s.end,
      text: s.line.text,
    })),
  );

  return createPractice({
    title: input.title,
    clipId: clip.id,
    mode: "shadowing-echo",
    roundIds: rounds.map((r) => r.id),
    showText: input.showText,
  });
}
