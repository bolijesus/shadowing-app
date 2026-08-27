"use client";

import { db } from "@/lib/db/db";
import { listBlobs, removeBlob } from "./opfs";

/**
 * GC de arranque: borra blobs en OPFS sin fila en el libro de bytes,
 * y filas del libro cuyo blob ya no existe (plan D2).
 */
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

  const orphanRows = ledger.filter((r) => !diskPaths.has(r.path));
  if (orphanRows.length) {
    await db().blobs.bulkDelete(orphanRows.map((r) => r.path));
  }

  return { removedFiles, removedRows: orphanRows.length };
}
