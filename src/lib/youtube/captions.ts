"use client";

import type { Cue } from "@/lib/types";

/**
 * Cliente del proxy de subtítulos. Todo error devuelve null: la UI ofrece
 * subir un .srt en su lugar y nunca muestra un fallo técnico (§4.2, §13.8).
 */

const ENABLED = process.env.NEXT_PUBLIC_CAPTIONS_PROXY !== "0";

export interface CaptionTrack {
  lang: string;
  name: string;
  kind: string;
}

export async function listCaptionTracks(
  videoId: string,
): Promise<CaptionTrack[] | null> {
  if (!ENABLED) return null;
  try {
    const res = await fetch(`/api/captions?videoId=${videoId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.tracks) ? json.tracks : null;
  } catch {
    return null;
  }
}

export async function fetchCaptions(
  videoId: string,
  lang: string,
): Promise<Cue[] | null> {
  if (!ENABLED) return null;
  try {
    const res = await fetch(
      `/api/captions?videoId=${videoId}&lang=${encodeURIComponent(lang)}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.cues) || json.cues.length === 0) return null;
    return json.cues as Cue[];
  } catch {
    return null;
  }
}
