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
 *
 * Lo delicado es la ALINEACIÓN. La grabación empieza cuando se llama a
 * `rec.start()`, no cuando el medio llega a `startSec`: entre medias hay un
 * salto de posición, la resolución de `play()` y el arranque del contexto, y
 * todo eso entra en la grabación como silencio por delante. Si no se
 * descuenta, la onda sale desplazada respecto al vídeo. Por eso se graba con
 * un margen antes del rango y se devuelve `offsetSec`: dónde cae `startSec`
 * dentro de lo grabado, medido contra el reloj del propio medio.
 */

/** Margen que se graba antes del rango para poder recortar con precisión. */
const PREROLL_SEC = 1.5;
/** Margen después, para que el final no se quede corto. */
const POSTROLL_SEC = 0.3;

export interface CaptureProgress {
  elapsedSec: number;
  totalSec: number;
}

export interface CapturedRange {
  blob: Blob;
  /** Segundos desde el inicio de la grabación hasta `startSec` del medio. */
  offsetSec: number;
  /** Duración pedida del rango. */
  durationSec: number;
}

export async function captureRangeAudio(
  file: Blob,
  startSec: number,
  endSec: number,
  onProgress?: (p: CaptureProgress) => void,
  signal?: AbortSignal,
): Promise<CapturedRange> {
  const total = Math.max(0, endSec - startSec);
  if (total <= 0) throw new Error("Rango vacío.");

  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.src = url;
  el.preload = "auto";
  el.playsInline = true;
  el.muted = false;

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

    // Se empieza ANTES del rango: así el instante `startSec` cae dentro de lo
    // grabado con margen de sobra y se puede recortar por el reloj del medio
    // en vez de confiar en que el salto y el play sean instantáneos.
    const from = Math.max(0, startSec - PREROLL_SEC);
    await seekTo(el, from);

    // El contexto tiene que estar corriendo antes de grabar: si está
    // suspendido, el grafo no avanza y la grabación saldría a trozos.
    await ctx.resume().catch(() => {});

    const wallRecStart = performance.now();
    rec.start(250);
    await el.play();

    /**
     * Muestreo (reloj de pared, reloj del medio). Con dos muestras que dejen
     * `startSec` en medio se interpola el instante exacto de la grabación en
     * que el medio pasó por ahí. A 20 ms de muestreo el error es de unos
     * pocos milisegundos, frente a los cientos que se colaban antes.
     */
    let prev: { wall: number; media: number } | null = null;
    let crossWall: number | null = null;
    const stopAt = Math.min(endSec + POSTROLL_SEC, Number.MAX_SAFE_INTEGER);

    await new Promise<void>((resolve, reject) => {
      const id = window.setInterval(() => {
        if (signal?.aborted) {
          window.clearInterval(id);
          reject(new Error("Cancelado."));
          return;
        }
        const wall = performance.now();
        const media = el.currentTime;

        if (crossWall === null) {
          if (prev && prev.media < startSec && media >= startSec) {
            // Interpolación lineal entre las dos muestras que lo rodean.
            const f = (startSec - prev.media) / (media - prev.media || 1);
            crossWall = prev.wall + (wall - prev.wall) * f;
          } else if (!prev && media > startSec) {
            // El medio ya iba por delante en la primera muestra (rango al
            // principio del archivo): se extrapola hacia atrás.
            crossWall = wall - (media - startSec) * 1000;
          }
        }
        prev = { wall, media };

        onProgress?.({
          elapsedSec: Math.max(0, Math.min(total, media - startSec)),
          totalSec: total,
        });

        if (media >= stopAt || el.ended) {
          window.clearInterval(id);
          resolve();
        }
      }, 20);
    });

    el.pause();
    rec.stop();
    const blob = await done;

    // Si por lo que sea no se pudo medir el cruce, se cae al valor teórico:
    // lo grabado empieza en `from`, así que `startSec` está a esa distancia.
    const offsetSec =
      crossWall === null
        ? Math.max(0, startSec - from)
        : Math.max(0, (crossWall - wallRecStart) / 1000);

    return { blob, offsetSec, durationSec: total };
  } finally {
    cleanup();
  }
}

/**
 * Salta a una posición y espera a que el salto haya terminado de verdad.
 *
 * Antes se resolvía en cuanto `readyState >= 2`, que suele cumplirse ya con
 * los datos ANTERIORES al salto: se empezaba a grabar mientras el elemento
 * todavía estaba buscando, y lo grabado no era el trozo pedido.
 */
function seekTo(el: HTMLMediaElement, sec: number): Promise<void> {
  if (Math.abs(el.currentTime - sec) < 0.001 && el.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const to = window.setTimeout(
      () => reject(new Error("El medio tardó demasiado en colocarse.")),
      20000,
    );
    el.addEventListener(
      "seeked",
      () => {
        window.clearTimeout(to);
        resolve();
      },
      { once: true },
    );
    el.currentTime = sec;
  });
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
