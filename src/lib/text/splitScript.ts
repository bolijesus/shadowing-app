/**
 * Trocea un guion pegado en frases practicables (§4.4).
 * Respeta los saltos de línea del usuario y, dentro de cada línea, corta
 * por puntuación fuerte. Las frases muy largas se parten por comas.
 */

const MAX_CHARS = 180;

export interface ScriptLine {
  index: number;
  text: string;
  /** Personaje si la línea venía como `NOMBRE: texto`. */
  speaker?: string;
}

const SPEAKER_RE = /^\s*([\p{Lu}][\p{L}\s.'-]{0,24}):\s*(.+)$/u;

export function splitScript(raw: string): ScriptLine[] {
  const out: ScriptLine[] = [];

  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let speaker: string | undefined;
    let body = line;
    const m = SPEAKER_RE.exec(line);
    if (m) {
      speaker = m[1]!.trim();
      body = m[2]!.trim();
    }

    for (const sentence of splitSentences(body)) {
      out.push({ index: out.length, text: sentence, speaker });
    }
  }
  return out;
}

function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?…。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= MAX_CHARS) {
      out.push(p);
      continue;
    }
    // Demasiado larga para una ronda: se parte por comas o punto y coma.
    let buf = "";
    for (const chunk of p.split(/(?<=[,;:])\s+/)) {
      if ((buf + " " + chunk).trim().length > MAX_CHARS && buf) {
        out.push(buf.trim());
        buf = chunk;
      } else {
        buf = (buf + " " + chunk).trim();
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.length ? out : [text];
}

/** Duración estimada al hablar, para poder colocar las rondas en el tiempo. */
export function estimateSpokenSec(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // ~2,6 palabras por segundo es un ritmo de lectura natural.
  return Math.max(1.2, (words / 2.6) / (rate || 1));
}
