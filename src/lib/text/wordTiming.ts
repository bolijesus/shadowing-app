/**
 * Tiempos aproximados por palabra, para el resaltado tipo karaoke.
 *
 * Sin ASR no hay tiempos reales (§6.4). El reparto proporcional a la
 * longitud de cada palabra es la aproximación que indica el prompt, pero a
 * secas falla: si la frase empieza con medio segundo de silencio, todas las
 * palabras se adelantan. Por eso, cuando hay envolvente de energía, se
 * reparte solo sobre los tramos con voz y se saltan las pausas.
 */

export interface WordSpan {
  index: number;
  startSec: number;
  endSec: number;
}

/** Peso de una palabra: las largas duran más, pero no proporcionalmente. */
function weightOf(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}']/gu, "").length;
  // Una constante evita que las palabras de una letra queden en un suspiro.
  return 0.6 + letters;
}

/** Reparto simple sobre toda la duración. */
export function distributeWords(
  words: string[],
  durationSec: number,
): WordSpan[] {
  if (!words.length || durationSec <= 0) return [];
  const weights = words.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return words.map((_, i) => {
    const span = (durationSec * weights[i]!) / total;
    const s = t;
    t += span;
    return { index: i, startSec: s, endSec: Math.min(t, durationSec) };
  });
}

/**
 * Reparto guiado por la energía: las palabras solo ocupan los tramos donde
 * hay voz. Es notablemente más fiel cuando el audio empieza o acaba en
 * silencio, o tiene una pausa larga en medio.
 */
export function distributeWordsOverSpeech(
  words: string[],
  durationSec: number,
  energy: Float32Array,
  hopSec: number,
  threshold = 0.08,
): WordSpan[] {
  if (!words.length || durationSec <= 0) return [];
  if (!energy || energy.length === 0) {
    return distributeWords(words, durationSec);
  }

  // Tramos con voz, fusionando los huecos muy cortos para no partir palabras.
  const minGapFrames = Math.max(1, Math.round(0.12 / hopSec));
  const segments: [number, number][] = [];
  let start = -1;
  let gap = 0;

  for (let i = 0; i < energy.length; i++) {
    if (energy[i]! >= threshold) {
      if (start === -1) start = i;
      gap = 0;
    } else if (start !== -1) {
      gap++;
      if (gap >= minGapFrames) {
        segments.push([start, i - gap + 1]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start !== -1) segments.push([start, energy.length]);

  const spans = segments
    .map(([a, b]) => [a * hopSec, Math.min(b * hopSec, durationSec)] as const)
    .filter(([a, b]) => b > a);

  const speechSec = spans.reduce((s, [a, b]) => s + (b - a), 0);
  if (!spans.length || speechSec <= 0) {
    return distributeWords(words, durationSec);
  }

  // Se reparte el peso total sobre el tiempo con voz, y se va consumiendo
  // tramo a tramo: las pausas quedan fuera y no consumen palabras.
  const weights = words.map(weightOf);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const secPerWeight = speechSec / totalWeight;

  const out: WordSpan[] = [];
  let seg = 0;
  let cursor = spans[0]![0];

  for (let i = 0; i < words.length; i++) {
    let remaining = weights[i]! * secPerWeight;
    const startSec = cursor;

    // Una palabra puede cruzar una pausa: se salta al siguiente tramo.
    while (remaining > 0 && seg < spans.length) {
      const segEnd = spans[seg]![1];
      const available = segEnd - cursor;
      if (remaining <= available) {
        cursor += remaining;
        remaining = 0;
      } else {
        remaining -= available;
        seg++;
        cursor = seg < spans.length ? spans[seg]![0] : segEnd;
      }
    }
    out.push({
      index: i,
      startSec,
      endSec: Math.min(cursor, durationSec),
    });
  }
  return out;
}

/** Cuánto lleva "cantado" cada palabra en el instante `t`. 0 a 1. */
export function fillAt(span: WordSpan, t: number): number {
  const dur = span.endSec - span.startSec;
  if (dur <= 0) return t >= span.endSec ? 1 : 0;
  return Math.max(0, Math.min(1, (t - span.startSec) / dur));
}
