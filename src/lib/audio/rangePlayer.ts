"use client";

/**
 * Reproducción por rango sobre un HTMLMediaElement: respeta [startSec, endSec]
 * con currentTime + timeupdate. Cero decodificación, cero copia de bytes (§5).
 */
export class RangePlayer {
  private el: HTMLMediaElement;
  private start = 0;
  private end = 0;
  private loop = false;
  /** Repeticiones que quedan. Infinity = sin límite. */
  private loopsLeft = Infinity;
  private onLoopCb: ((left: number) => void) | null = null;
  private onEndCb: (() => void) | null = null;

  /**
   * Fin efectivo del rango. Quien reproduce un medio entero (una voz TTS,
   * una toma) pasa un `endSec` centinela; aquí se resuelve a la duración
   * real en cuanto el navegador la conoce, para que el progreso avance.
   */
  private get limit(): number {
    if (this.end < Number.MAX_SAFE_INTEGER) return this.end;
    return isFinite(this.el.duration) && this.el.duration > 0
      ? this.el.duration
      : this.end;
  }

  private tick = () => {
    if (this.limit <= this.start) return; // rango aún sin fijar
    if (this.el.currentTime >= this.limit - 0.02) {
      if (this.loop && this.loopsLeft > 1) {
        // §7: el bucle A–B repite N veces, no eternamente.
        if (Number.isFinite(this.loopsLeft)) this.loopsLeft -= 1;
        this.onLoopCb?.(this.loopsLeft);
        this.el.currentTime = this.start;
      } else {
        this.el.pause();
        this.el.currentTime = this.start;
        this.onEndCb?.();
      }
    }
  };

  constructor(el: HTMLMediaElement) {
    this.el = el;
    this.el.addEventListener("timeupdate", this.tick);
  }

  setRange(startSec: number, endSec: number) {
    this.start = startSec;
    this.end = endSec;
    if (this.el.currentTime < startSec || this.el.currentTime > endSec) {
      try {
        this.el.currentTime = startSec;
      } catch {
        /* metadata aún no lista */
      }
    }
  }

  /** `times` = Infinity para bucle sin fin. */
  setLoop(v: boolean, times: number = Infinity) {
    this.loop = v;
    this.loopsLeft = v ? times : Infinity;
  }

  /** Repeticiones restantes, para poder mostrarlas. */
  get loopsRemaining(): number {
    return this.loop ? this.loopsLeft : 0;
  }

  onLoop(cb: (left: number) => void) {
    this.onLoopCb = cb;
  }

  set playbackRate(r: number) {
    this.el.playbackRate = r;
    // Evita el efecto "ardilla" al cambiar la velocidad (§13.4).
    const anyEl = this.el as HTMLMediaElement & { preservesPitch?: boolean };
    anyEl.preservesPitch = true;
  }

  async play(fromStart = false) {
    if (
      fromStart ||
      this.el.currentTime < this.start ||
      this.el.currentTime >= this.limit
    ) {
      this.el.currentTime = this.start;
    }
    try {
      await this.el.play();
    } catch (e) {
      // Encadenar play() y pause() rápido aborta la promesa anterior; es
      // esperado al saltar de ronda o al comparar pistas, no un fallo.
      if ((e as DOMException)?.name !== "AbortError") throw e;
    }
  }

  pause() {
    this.el.pause();
  }

  /**
   * Salta a una fracción del rango (0–1) y reproduce desde ahí. Sirve para
   * repetir una palabra concreta pinchando en la onda.
   */
  async seekRatio(ratio: number, play = true): Promise<void> {
    const span = this.limit - this.start;
    if (!isFinite(span) || span <= 0) return;
    const t = this.start + Math.max(0, Math.min(1, ratio)) * span;
    try {
      this.el.currentTime = t;
    } catch {
      return; // metadata aún no lista
    }
    if (play && this.el.paused) {
      try {
        await this.el.play();
      } catch (e) {
        if ((e as DOMException)?.name !== "AbortError") throw e;
      }
    }
  }

  toggle() {
    if (this.el.paused) void this.play();
    else this.pause();
  }

  get playing() {
    return !this.el.paused;
  }

  get position() {
    const span = this.limit - this.start;
    if (!isFinite(span) || span <= 0) return 0;
    return Math.min(1, Math.max(0, (this.el.currentTime - this.start) / span));
  }

  onEnded(cb: () => void) {
    this.onEndCb = cb;
  }

  destroy() {
    this.el.removeEventListener("timeupdate", this.tick);
    this.el.pause();
  }
}
