"use client";

/**
 * Reproducción por rango sobre un HTMLMediaElement: respeta [startSec, endSec]
 * con currentTime. Cero decodificación, cero copia de bytes (§5).
 *
 * Dos cosas que en vídeo no son opcionales:
 *
 * - El final del rango se vigila con requestAnimationFrame, no solo con
 *   `timeupdate`. Ese evento lo dispara el navegador cuando quiere —hasta
 *   250 ms de separación, y más si la decodificación va apurada—, así que el
 *   audio se pasaba del final de la frase antes de que nadie lo parara.
 * - Saltar de posición mientras suena se hace con el elemento PAUSADO. Si se
 *   salta en marcha, el audio arranca ya en el destino mientras la imagen se
 *   queda congelada hasta el siguiente fotograma clave: el vídeo parece
 *   detenido y el audio sigue. Pausar, saltar y volver a dar al play cuesta
 *   un parpadeo y mantiene imagen y sonido juntos.
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
  private readonly isVideo: boolean;
  /** Salto en curso: hay que ignorar los ticks hasta que termine. */
  private seeking = false;
  /** Identifica el salto vigente; uno nuevo invalida al anterior. */
  private seekToken = 0;
  private raf = 0;
  private destroyed = false;

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
    if (this.seeking || this.el.paused) return;
    if (this.limit <= this.start) return; // rango aún sin fijar
    if (this.el.currentTime >= this.limit - 0.02) {
      if (this.loop && this.loopsLeft > 1) {
        // §7: el bucle A–B repite N veces, no eternamente.
        if (Number.isFinite(this.loopsLeft)) this.loopsLeft -= 1;
        this.onLoopCb?.(this.loopsLeft);
        void this.seek(this.start, true);
      } else {
        this.el.pause();
        void this.seek(this.start, false);
        this.onEndCb?.();
      }
    }
  };

  private frame = () => {
    if (this.destroyed) return;
    this.tick();
    this.raf = requestAnimationFrame(this.frame);
  };

  constructor(el: HTMLMediaElement) {
    this.el = el;
    this.isVideo = el.tagName === "VIDEO";
    // `timeupdate` se mantiene como red de seguridad: en una pestaña de
    // fondo el navegador congela requestAnimationFrame pero sigue avisando.
    this.el.addEventListener("timeupdate", this.tick);
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * Coloca el cabezal. Con vídeo en marcha se pausa antes y se reanuda al
   * terminar el salto, para que imagen y sonido no se separen.
   */
  private async seek(t: number, resume: boolean): Promise<void> {
    const token = ++this.seekToken;
    const wasPlaying = !this.el.paused;
    this.seeking = true;
    if (wasPlaying && this.isVideo) this.el.pause();

    try {
      this.el.currentTime = t;
    } catch {
      this.seeking = false; // metadata aún no lista
      return;
    }

    if (this.isVideo && (wasPlaying || resume)) await this.waitSeeked();
    if (token !== this.seekToken) return; // llegó otro salto: manda el nuevo
    this.seeking = false;

    if (resume && wasPlaying && this.el.paused) await this.start_();
  }

  /** Espera al `seeked`, con tope por si el navegador no lo emite. */
  private waitSeeked(): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.el.removeEventListener("seeked", finish);
        clearTimeout(to);
        resolve();
      };
      const to = setTimeout(finish, 1500);
      this.el.addEventListener("seeked", finish, { once: true });
    });
  }

  private async start_(): Promise<void> {
    try {
      await this.el.play();
    } catch (e) {
      // Encadenar play() y pause() rápido aborta la promesa anterior; es
      // esperado al saltar de ronda o al comparar pistas, no un fallo.
      if ((e as DOMException)?.name !== "AbortError") throw e;
    }
  }

  setRange(startSec: number, endSec: number) {
    this.start = startSec;
    this.end = endSec;
    if (this.el.currentTime < startSec || this.el.currentTime > endSec) {
      void this.seek(startSec, true);
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
    const outside =
      this.el.currentTime < this.start || this.el.currentTime >= this.limit;
    if (fromStart || outside) {
      // Se coloca con el elemento parado y se arranca después: así el vídeo
      // no empieza a sonar sobre una imagen que aún no ha llegado.
      const token = ++this.seekToken;
      this.seeking = true;
      try {
        this.el.currentTime = this.start;
      } catch {
        /* metadata aún no lista */
      }
      if (this.isVideo) await this.waitSeeked();
      if (token !== this.seekToken) return;
      this.seeking = false;
    }
    await this.start_();
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
    const wasPlaying = !this.el.paused;
    await this.seek(t, wasPlaying);
    if (play && this.el.paused) await this.start_();
  }

  toggle() {
    if (this.el.paused) void this.play();
    else this.pause();
  }

  /**
   * Durante un salto el elemento está pausado a propósito. Contarlo como
   * "parado" haría parpadear el botón de reproducción en cada vuelta.
   */
  get playing() {
    return !this.el.paused || this.seeking;
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
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.seekToken++;
    this.el.removeEventListener("timeupdate", this.tick);
    this.el.pause();
  }
}
