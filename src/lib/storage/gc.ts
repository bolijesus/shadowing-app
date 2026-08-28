"use client";

import { db } from "@/lib/db/db";
import { listBlobs, removeBlob } from "./opfs";

/**
 * GC de arranque: borra blobs en OPFS sin fila en el libro de bytes,
 * y filas del libro cuyo blob ya no existe (plan D2).
 */
/**
 * Análisis guardados con el formato de clave antiguo, sin el rango.
 * `analysis/peaks_c1.bin` es viejo; `analysis/peaks_c1_600000-660000.bin` no.
 * Los viejos ya no los busca nadie: se recalculan con la clave nueva, así que
 * hay que retirarlos o se quedarían ocupando sitio para siempre.
 */
function isLegacyAnalysis(path: string): boolean {
  const m = /^analysis\/(peaks|round)_(.+)\.bin$/.exec(path);
  if (!m) return false;
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

  // Análisis con la clave antigua: nadie los va a volver a pedir.
  const legacy = ledger.filter(
    (r) => isLegacyAnalysis(r.path) && diskPaths.has(r.path),
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
