"use client";

/**
 * IFrame Player API de YouTube (§4.2).
 *
 * Límite real, no negociable: el navegador NO da acceso al PCM del
 * reproductor. Para material de YouTube no hay forma de onda del modelo,
 * ni curva de entonación del modelo, ni puntuación acústica comparativa.
 * Sí hay reproducción por rangos, bucles, subtítulos, texto y análisis de
 * TU voz. Nunca se descarga el vídeo ni el audio.
 */

export const YOUTUBE_LIMITS_NOTE =
  "Modo YouTube: reproducción y ejercicios de texto. Para comparar tu curva de entonación con el modelo, sube el audio como archivo.";

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = /\/(embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[2]!;
    }
  } catch {
    /* no era una URL */
  }
  return null;
}

/* --------------------------- carga de la API --------------------------- */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: Record<string, unknown>,
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Solo en el navegador"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "No se pudo cargar el reproductor de YouTube. ¿Hay conexión?",
          ),
        ),
      15000,
    );
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("API de YouTube no disponible"));
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("No se pudo cargar el reproductor de YouTube."));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/** Reproductor limitado a un rango, equivalente a RangePlayer. */
export class YouTubeRangePlayer {
  private player: YTPlayer | null = null;
  private start = 0;
  private end = 0;
  private loop = false;
  private timer: number | null = null;
  private onEndCb: (() => void) | null = null;

  async mount(container: HTMLElement, videoId: string): Promise<void> {
    const YT = await loadYouTubeApi();
    await new Promise<void>((resolve) => {
      this.player = new YT.Player(container, {
        videoId,
        playerVars: {
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: { onReady: () => resolve() },
      });
    });
    this.timer = window.setInterval(() => this.tick(), 120);
  }

  private tick() {
    const p = this.player;
    if (!p || this.end <= this.start) return;
    let t = 0;
    try {
      t = p.getCurrentTime();
    } catch {
      return;
    }
    if (t >= this.end - 0.08) {
      if (this.loop) p.seekTo(this.start, true);
      else {
        p.pauseVideo();
        p.seekTo(this.start, true);
        this.onEndCb?.();
      }
    }
  }

  setRange(startSec: number, endSec: number) {
    this.start = startSec;
    this.end = endSec;
    try {
      this.player?.seekTo(startSec, true);
    } catch {
      /* aún no está listo */
    }
  }
  setLoop(v: boolean) {
    this.loop = v;
  }
  setRate(rate: number) {
    try {
      this.player?.setPlaybackRate(rate);
    } catch {
      /* noop */
    }
  }
  play(fromStart = true) {
    if (!this.player) return;
    if (fromStart) this.player.seekTo(this.start, true);
    this.player.playVideo();
  }
  pause() {
    this.player?.pauseVideo();
  }
  get position(): number {
    if (!this.player || this.end <= this.start) return 0;
    try {
      return Math.min(
        1,
        Math.max(
          0,
          (this.player.getCurrentTime() - this.start) / (this.end - this.start),
        ),
      );
    } catch {
      return 0;
    }
  }
  get duration(): number {
    try {
      return this.player?.getDuration() ?? 0;
    } catch {
      return 0;
    }
  }
  onEnded(cb: () => void) {
    this.onEndCb = cb;
  }
  destroy() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    try {
      this.player?.destroy();
    } catch {
      /* noop */
    }
    this.player = null;
  }
}
