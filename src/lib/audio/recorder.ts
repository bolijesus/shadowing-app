"use client";

import { acquireMic, type MicOptions } from "./context";

/**
 * Abstracción de MediaRecorder. Detecta el mime soportado y lo guarda
 * junto al blob (audio/mp4 en Safari, audio/webm;codecs=opus en Chrome).
 */

const CANDIDATE_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/ogg;codecs=opus",
];

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of CANDIDATE_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/** Latencia de grabación por defecto si no hay calibración (plan D3). */
export function defaultLatencyOffsetMs(): number {
  const mobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return mobile ? 150 : 80;
}

export interface RecordingResult {
  blob: Blob;
  mime: string;
  durationSec: number;
}

export class VoiceRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mime = "";

  async start(mic: MicOptions): Promise<void> {
    const stream = await acquireMic(mic);
    this.mime = pickRecorderMime();
    this.chunks = [];
    this.rec = this.mime
      ? new MediaRecorder(stream, { mimeType: this.mime })
      : new MediaRecorder(stream);
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.startedAt = performance.now();
  }

  get recording(): boolean {
    return this.rec?.state === "recording";
  }

  async stop(): Promise<RecordingResult> {
    const rec = this.rec;
    if (!rec) throw new Error("No hay grabación en curso");
    const durationSec = (performance.now() - this.startedAt) / 1000;
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () =>
        resolve(new Blob(this.chunks, { type: this.mime || rec.mimeType || "audio/webm" }));
    });
    rec.stop();
    const blob = await done;
    this.rec = null;
    return { blob, mime: blob.type, durationSec };
  }

  cancel(): void {
    try {
      this.rec?.stop();
    } catch {
      /* noop */
    }
    this.rec = null;
    this.chunks = [];
  }
}
