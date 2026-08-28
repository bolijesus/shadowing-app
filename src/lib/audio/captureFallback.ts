"use client";

/**
 * Plan B cuando `decodeAudioData` no puede con el archivo.
 *
 * Hay contenedores y códecs que el navegador REPRODUCE pero que Web Audio no
 * sabe decodificar por su cuenta: AC-3 y E-AC-3 (habituales en capturas de
 * televisión), algunos perfiles de AAC, MKV… El síntoma es "Unable to decode
 * audio data" y, antes, una onda que no aparecía nunca.
 *
 * Aquí se aprovecha que el propio navegador sí sabe reproducirlo: se enruta
 * el audio del elemento por Web Audio hacia un MediaRecorder y se obtiene un
 * webm/opus, que sí es decodificable. Va en tiempo real —40 s de recorte son
 * 40 s de espera— así que solo se usa como último recurso y con progreso.
 */

export interface CaptureProgress {
  elapsedSec: number;
  totalSec: number;
}

export async function captureRangeAudio(
  file: Blob,
  startSec: number,
  endSec: number,
  onProgress?: (p: CaptureProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const total = Math.max(0, endSec - startSec);
  if (total <= 0) throw new Error("Rango vacío.");

  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.src = url;
  el.preload = "auto";
  el.playsInline = true;

  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtor();

  const cleanup = () => {
    try {
      el.pause();
    } catch {
      /* noop */
    }
    URL.revokeObjectURL(url);
    void ctx.close().catch(() => {});
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const ok = () => resolve();
      const bad = () =>
        reject(new Error("El navegador tampoco puede reproducir este archivo."));
      el.addEventListener("loadedmetadata", ok, { once: true });
      el.addEventListener("error", bad, { once: true });
      setTimeout(() => reject(new Error("El medio tardó demasiado en abrirse.")), 20000);
    });

    // El audio va SOLO al grabador: no se conecta a los altavoces, así que
    // la captura es silenciosa.
    const src = ctx.createMediaElementSource(el);
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);

    const mime = pickMime();
    const rec = new MediaRecorder(
      dest.stream,
      mime ? { mimeType: mime } : undefined,
    );
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () =>
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    });

    el.currentTime = startSec;
    await new Promise<void>((r) => {
      if (el.readyState >= 2) r();
      else el.addEventListener("seeked", () => r(), { once: true });
    });

    rec.start(250);
    await ctx.resume().catch(() => {});
    await el.play();

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) {
          cleanupTimer();
          reject(new Error("Cancelado."));
          return;
        }
        const elapsed = el.currentTime - startSec;
        onProgress?.({ elapsedSec: Math.max(0, elapsed), totalSec: total });
        if (el.currentTime >= endSec || el.ended) {
          cleanupTimer();
          resolve();
        }
      };
      const id = window.setInterval(tick, 120);
      const cleanupTimer = () => window.clearInterval(id);
    });

    el.pause();
    rec.stop();
    return await done;
  } finally {
    cleanup();
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
