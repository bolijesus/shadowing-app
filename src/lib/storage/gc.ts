"use client";

import { db } from "@/lib/db/db";
import { listBlobs, removeBlob } from "./opfs";

/**
 * GC de arranque: borra blobs en OPFS sin fila en el libro de bytes,
 * y filas del libro cuyo blob ya no existe (plan D2).
 */
/**
 * Análisis que ya no busca nadie y hay que retirar, o se quedarían ocupando
 * sitio para siempre. Son dos casos:
 *
 * - Clave antigua, sin el rango: `analysis/peaks_c1.bin` es vieja;
 *   `analysis/peaks_c1_600000-660000.bin` no. Se recalculan con la nueva.
 * - Todos los `peaks_`: la onda del modelo salía de trocear los picos del
 *   recorte entero, y eso daba la resolución del recorte, no la de la ronda.
 *   Ahora cada ronda usa su propio análisis (`round_`) y estos no se leen.
 */
function isRetiredAnalysis(path: string): boolean {
  const m = /^analysis\/(peaks|round)_(.+)\.bin$/.exec(path);
  if (!m) return false;
  if (m[1] === "peaks") return true;
  return !/_\d+-(\d+|end)$/.test(m[2]!);
}

export async function runStartupGc(): Promise<{ removedFiles: number; removedRows: number }> {
  const [onDisk, ledger] = await Promise.all([
    listBlobs(),
    db().blobs.toArray(),
  ]);

  const ledgerPaths = new Set(ledger.map((r) => r.path));
  const diskPaths = new Set(onDisk.map((f) => f.path));

  let removedFiles = 0;
  for (const f of onDisk) {
    if (!ledgerPaths.has(f.path)) {
      await removeBlob(f.path);
      removedFiles++;
    }
  }

  // Análisis retirados: nadie los va a volver a pedir.
  const legacy = ledger.filter(
    (r) => isRetiredAnalysis(r.path) && diskPaths.has(r.path),
  );
  for (const r of legacy) {
    await removeBlob(r.path);
    removedFiles++;
  }

  const orphanRows = ledger.filter(
    (r) => !diskPaths.has(r.path) || legacy.includes(r),
  );
  if (orphanRows.length) {
    await db().blobs.bulkDelete(orphanRows.map((r) => r.path));
  }

  return { removedFiles, removedRows: orphanRows.length };
}
