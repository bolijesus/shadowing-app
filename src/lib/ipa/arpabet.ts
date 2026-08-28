/**
 * ARPABET (el formato de cmudict) a IPA.
 * Los dígitos finales marcan el acento: 1 primario, 2 secundario, 0 átono.
 * Se convierten en los marcadores ˈ y ˌ delante de la sílaba (§6.5).
 */

const MAP: Record<string, string> = {
  // Vocales
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ",
  EH: "ɛ", ER: "ɝ", EY: "eɪ", IH: "ɪ", IY: "i", OW: "oʊ",
  OY: "ɔɪ", UH: "ʊ", UW: "u",
  // Consonantes
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h",
  JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p",
  R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w",
  Y: "j", Z: "z", ZH: "ʒ",
};

/** Vocales ARPABET: marcan dónde empieza cada sílaba. */
const VOWELS = new Set([
  "AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW",
]);

export interface ArpaResult {
  ipa: string;
  /** Índice de sílaba con acento primario (0-based), o -1. */
  primaryStress: number;
  /** Todos los niveles de acento por sílaba, en orden. */
  stress: number[];
}

/**
 * `P R IH0 D IH1 K T` → `pɹɪˈdɪkt`
 * El marcador se coloca al inicio de la sílaba, no delante de la vocal:
 * las consonantes previas del ataque van dentro de la sílaba tónica.
 */
export function arpabetToIpa(arpa: string): ArpaResult {
  const tokens = arpa.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { ipa: "", primaryStress: -1, stress: [] };

  // Se agrupa en sílabas: cada una acaba en su vocal, y las consonantes
  // sueltas del final se pegan a la última.
  const syllables: { symbols: string[]; stress: number }[] = [];
  let current: string[] = [];

  for (const tok of tokens) {
    const m = /^([A-Z]+)([0-2])?$/.exec(tok);
    if (!m) continue;
    const base = m[1]!;
    const stressDigit = m[2];
    current.push(base);
    if (VOWELS.has(base)) {
      syllables.push({
        symbols: current,
        stress: stressDigit ? Number(stressDigit) : 0,
      });
      current = [];
    }
  }
  if (current.length) {
    if (syllables.length) syllables[syllables.length - 1]!.symbols.push(...current);
    else syllables.push({ symbols: current, stress: 0 });
  }

  const stress = syllables.map((s) => s.stress);
  const primaryStress = stress.indexOf(1);

  const ipa = syllables
    .map((syl) => {
      const body = syl.symbols.map((s) => MAP[s] ?? "").join("");
      const mark = syl.stress === 1 ? "ˈ" : syl.stress === 2 ? "ˌ" : "";
      return mark + body;
    })
    .join("");

  return { ipa, primaryStress, stress };
}
