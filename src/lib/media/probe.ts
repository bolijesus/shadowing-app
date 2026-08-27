"use client";

const VIDEO_HINT = /(mp4|webm|mov|quicktime|ogg)$/i;

export interface MediaProbe {
  durationSec: number;
  hasVideo: boolean;
}

/** Lee duración y si tiene pista de vídeo, sin decodificar el audio. */
export async function probeMedia(file: Blob, fileName = ""): Promise<MediaProbe> {
  const url = URL.createObjectURL(file);
  try {
    const maybeVideo =
      (file.type && file.type.startsWith("video/")) || VIDEO_HINT.test(fileName);
    const el = document.createElement(maybeVideo ? "video" : "audio");
    el.preload = "metadata";
    el.muted = true;
    el.src = url;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error("No se pudo leer el medio"));
      el.addEventListener("loadedmetadata", onLoaded, { once: true });
      el.addEventListener("error", onError, { once: true });
      setTimeout(() => resolve(), 8000);
    });

    const durationSec = isFinite(el.duration) ? el.duration : 0;
    const hasVideo =
      el instanceof HTMLVideoElement && el.videoWidth > 0 && el.videoHeight > 0;
    return { durationSec, hasVideo };
  } finally {
    URL.revokeObjectURL(url);
  }
}
