"use client";

import { db } from "@/lib/db/db";
import type { Round } from "@/lib/types";
import { getKeystore } from "@/lib/crypto/keystore";
import { synthesizeCached } from "./cache";
import { styleById, TtsError, type TtsProviderId, type TtsRequest } from "./types";

/** Estado por ronda mostrado en el editor (§4.3). */
export type PrepState = "idle" | "pending" | "ready" | "error";

export interface RoundVoice {
  provider: TtsProviderId;
  voice: string;
  style: string;
  rate: number;
}

export function requestForRound(
  round: Round,
  voice: RoundVoice,
  language: string,
): TtsRequest {
  const style = styleById(voice.style);
  return {
    provider: voice.provider,
    voice: voice.voice,
    style: style.instruction,
    rate: voice.rate ?? style.rate,
    text: round.text,
    language,
  };
}

function credentialsFor(provider: TtsProviderId) {
  const ks = getKeystore();
  return ks?.providers[provider] ?? {};
}

/** Prepara la voz de una ronda y guarda la referencia en la fila. */
export async function prepareRound(
  round: Round,
  voice: RoundVoice,
  language: string,
): Promise<{ path: string; fromCache: boolean }> {
  if (!round.text.trim()) {
    throw new TtsError("Esta ronda no tiene texto que decir.");
  }
  const req = requestForRound(round, voice, language);
  const res = await synthesizeCached(req, credentialsFor(voice.provider));
  await db().rounds.update(round.id, {
    modelAudioRef: res.path,
    ttsProvider: voice.provider,
    ttsVoice: voice.voice,
    ttsStyle: voice.style,
  });
  return res;
}

export interface QueueProgress {
  roundId: string;
  index: number;
  totalRounds: number;
  state: PrepState;
  error?: string;
}

/**
 * "Preparar todas las voces": cola secuencial con reintentos.
 * Secuencial a propósito — las APIs de TTS limitan por minuto y la
 * caché evita repetir trabajo entre ejecuciones.
 */
export async function prepareAll(
  rounds: Round[],
  voiceFor: (round: Round) => RoundVoice,
  language: string,
  onProgress: (p: QueueProgress) => void,
  signal?: AbortSignal,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;

  for (let i = 0; i < rounds.length; i++) {
    if (signal?.aborted) break;
    const round = rounds[i]!;
    onProgress({
      roundId: round.id,
      index: i,
      totalRounds: rounds.length,
      state: "pending",
    });

    let lastError = "";
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await prepareRound(round, voiceFor(round), language);
        ok = true;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Error desconocido";
        const retryable = e instanceof TtsError ? e.retryable : false;
        if (!retryable) break;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }

    if (ok) {
      done++;
      onProgress({
        roundId: round.id,
        index: i,
        totalRounds: rounds.length,
        state: "ready",
      });
    } else {
      failed++;
      onProgress({
        roundId: round.id,
        index: i,
        totalRounds: rounds.length,
        state: "error",
        error: lastError,
      });
    }
  }

  return { done, failed };
}
