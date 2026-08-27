import type { RoundScore } from "./scoreRound";

/**
 * Consejo concreto, una sola frase, generado por reglas — nunca por IA (§6.6).
 * Se elige la regla con el problema más grave que sí se ha medido.
 */
export function buildAdvice(score: RoundScore): string | undefined {
  const d = score.detail;
  const has = (k: keyof typeof score.components) =>
    typeof score.components[k] === "number";

  // 1. Demasiado lento / demasiado rápido frente al modelo.
  if (d.durModelSec > 0 && d.durTakeSec > 0) {
    const ratio = d.durTakeSec / d.durModelSec;
    if (ratio > 1.15) {
      return "Vas más lento que el modelo. Enlaza las palabras del grupo fónico en lugar de separarlas.";
    }
    if (ratio < 0.85) {
      return "Vas más rápido que el modelo. Deja respirar las vocales largas y marca bien el final de la frase.";
    }
  }

  // 2. Entonación plana frente a un modelo con relieve.
  if (has("intonation") && d.rangeModelSt > 2 && d.rangeTakeSt < d.rangeModelSt * 0.6) {
    return "Tu entonación es plana: exagera la subida en la palabra clave.";
  }

  // 3. Pausas de más, dentro del grupo de sentido.
  if (has("timing") && d.pausesTake > d.pausesModel + 1) {
    return "Estás pausando dentro del grupo de sentido; respira solo donde lo hace el modelo.";
  }

  // 4. Forma rítmica floja.
  if (has("rhythmShape") && (score.components.rhythmShape ?? 100) < 60) {
    return "El acento cae en sílabas distintas a las del modelo: marca más fuerte las tónicas y reduce las átonas.";
  }

  // 5. Palabras (solo con ASR).
  if (has("words") && (score.components.words ?? 100) < 70) {
    return "Se te han perdido palabras respecto al texto: baja la velocidad y articula los finales.";
  }

  if (score.total >= 85) {
    return "Muy cerca del modelo. Sube la velocidad un escalón para consolidarlo.";
  }
  return undefined;
}

/** Etiqueta corta de cómo se ha calculado la nota (honestidad §13.9). */
export function scoreBasisLabel(score: RoundScore): string {
  const acoustic = score.present.filter((k) => k !== "words");
  if (score.present.includes("words") && acoustic.length) {
    return "Nota híbrida · reconocimiento de voz más duración y ritmo medidos";
  }
  if (acoustic.length) {
    return "Nota acústica medida · duración, ritmo y entonación frente al modelo";
  }
  if (score.present.includes("words")) {
    return "Solo palabras · sin audio del modelo no hay comparación acústica";
  }
  return "Sin datos suficientes para puntuar";
}
