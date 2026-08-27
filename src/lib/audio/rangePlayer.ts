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
  private onEndCb: (() => void) | null = null;
  private tick = () => {
    if (this.el.currentTime >= this.end - 0.02) {
      if (this.loop) {
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

  setLoop(v: boolean) {
    this.loop = v;
  }

  set playbackRate(r: number) {
    this.el.playbackRate = r;
    // Evita el efecto "ardilla" al cambiar la velocidad (§13.4).
    const anyEl = this.el as HTMLMediaElement & { preservesPitch?: boolean };
    anyEl.preservesPitch = true;
  }

  async play(fromStart = false) {
    if (fromStart || this.el.currentTime < this.start || this.el.currentTime >= this.end) {
      this.el.currentTime = this.start;
    }
    await this.el.play();
  }

  pause() {
    this.el.pause();
  }

  toggle() {
    if (this.el.paused) void this.play();
    else this.pause();
  }

  get playing() {
    return !this.el.paused;
  }

  get position() {
    return Math.min(1, Math.max(0, (this.el.currentTime - this.start) / (this.end - this.start || 1)));
  }

  onEnded(cb: () => void) {
    this.onEndCb = cb;
  }

  destroy() {
    this.el.removeEventListener("timeupdate", this.tick);
    this.el.pause();
  }
}
