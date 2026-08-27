"use client";

/**
 * AudioContext singleton. Debe crearse/reanudarse dentro de un gesto
 * del usuario (iOS). El micrófono se pide solo la primera vez que se graba.
 */

let _ctx: AudioContext | null = null;
let _micStream: MediaStream | null = null;

export function ensureAudioContext(): AudioContext {
  if (!_ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    _ctx = new Ctor();
  }
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

export function audioContextState(): AudioContextState | "none" {
  return _ctx ? _ctx.state : "none";
}

export interface MicOptions {
  /** true cuando el usuario confirma auriculares: mejora el análisis. */
  disableEchoCancellation: boolean;
}

export async function acquireMic(opts: MicOptions): Promise<MediaStream> {
  if (_micStream && _micStream.getAudioTracks().some((t) => t.readyState === "live")) {
    return _micStream;
  }
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: !opts.disableEchoCancellation,
      autoGainControl: false,
      noiseSuppression: false,
      channelCount: 1,
    },
  };
  _micStream = await navigator.mediaDevices.getUserMedia(constraints);
  return _micStream;
}

export function releaseMic(): void {
  _micStream?.getTracks().forEach((t) => t.stop());
  _micStream = null;
}

export function hasMicPermissionGranted(): Promise<boolean> {
  if (!navigator.permissions?.query) return Promise.resolve(false);
  return navigator.permissions
    .query({ name: "microphone" as PermissionName })
    .then((s) => s.state === "granted")
    .catch(() => false);
}
