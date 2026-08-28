import type { PracticeMode } from "@/lib/types";

/**
 * Catálogo de modos (§7). `built` dice la verdad sobre lo que hay hecho:
 * la pantalla de Actividades no debe ofrecer un modo que luego no exista,
 * y tampoco conviene esconder que están previstos.
 */
export interface ModeMeta {
  id: PracticeMode;
  label: string;
  summary: string;
  built: boolean;
  /** Qué necesita para funcionar; se avisa antes de elegirlo. */
  needs?: "model-audio" | "speakers";
}

export const MODES: ModeMeta[] = [
  {
    id: "shadowing-echo",
    label: "Shadowing · Eco",
    summary: "Escuchas la frase y la repites. El modo principal.",
    built: true,
  },
  {
    id: "curve-duel",
    label: "Duelo de curvas",
    summary:
      "Ves la curva de entonación del modelo, sin oírla, e intentas reproducirla.",
    built: true,
    needs: "model-audio",
  },
  {
    id: "shadowing-sync",
    label: "Shadowing · Simultáneo",
    summary: "Hablas encima del modelo mientras suena.",
    built: false,
  },
  {
    id: "read-aloud",
    label: "Lectura en voz alta",
    summary: "Sin audio de modelo: solo el texto.",
    built: false,
  },
  {
    id: "speed-ladder",
    label: "Escalera de velocidad",
    summary: "La misma frase cada vez más rápida, si superas el umbral.",
    built: false,
  },
  {
    id: "dictation",
    label: "Dictado",
    summary: "Escribes lo que oyes y se compara palabra a palabra.",
    built: false,
  },
  {
    id: "cloze",
    label: "Completar palabras",
    summary: "Rellenas huecos escribiendo.",
    built: false,
  },
  {
    id: "minimal-pairs",
    label: "Pares mínimos",
    summary: "Escuchas y distingues sonidos parecidos: ship / sheep.",
    built: false,
  },
  {
    id: "stress-tap",
    label: "Marca el acento",
    summary: "Tocas en cada sílaba tónica mientras suena.",
    built: false,
  },
  {
    id: "reorder",
    label: "Ordena la frase",
    summary: "Colocas los grupos fónicos desordenados.",
    built: false,
  },
  {
    id: "anticipation",
    label: "Anticipación",
    summary: "El audio se corta y dices tú la continuación.",
    built: false,
  },
  {
    id: "roleplay",
    label: "Diálogo por roles",
    summary: "Eliges personaje y dices sus líneas en su hueco.",
    built: false,
    needs: "speakers",
  },
  {
    id: "dubbing",
    label: "Doblaje",
    summary: "El vídeo va mudo y pones tú la voz.",
    built: false,
  },
];

export function modeMeta(id: PracticeMode): ModeMeta | undefined {
  return MODES.find((m) => m.id === id);
}

export function builtModes(): ModeMeta[] {
  return MODES.filter((m) => m.built);
}
