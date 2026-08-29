import type { PracticeMode } from "@/lib/types";

/**
 * Catálogo de modos. Solo están los que existen de verdad: un modo listado
 * que luego no se puede abrir es una promesa rota en la pantalla de crear.
 */
export interface ModeMeta {
  id: PracticeMode;
  label: string;
  summary: string;
}

export const MODES: ModeMeta[] = [
  {
    id: "shadowing-echo",
    label: "Shadowing · Eco",
    summary: "Escuchas la frase y la repites. El modo principal.",
  },
  {
    id: "curve-duel",
    label: "Duelo de curvas",
    summary:
      "Ves la curva de entonación del modelo, sin oírla, e intentas reproducirla.",
  },
];

export function modeMeta(id: PracticeMode): ModeMeta | undefined {
  return MODES.find((m) => m.id === id);
}
