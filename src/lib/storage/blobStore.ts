"use client";

import { db } from "@/lib/db/db";
import type { BlobCategory } from "@/lib/types";
import { removeBlob, writeBlob } from "./opfs";

/**
 * Escritura/borrado coordinado de blob + fila del libro de bytes.
 * Crear: blob primero, luego fila con el tamaño real (plan D2).
 * Borrar: fila primero, luego blob.
 */

export async function putBlob(
  path: string,
  data: ArrayBuffer | Blob,
  category: BlobCategory,
  ownerId?: string,
): Promise<{ path: string; bytes: number }> {
  const bytes = await writeBlob(path, data);
  await db().blobs.put({
    path,
    category,
    bytes,
    createdAt: Date.now(),
    ownerId,
  });
  return { path, bytes };
}

export async function deleteBlob(path: string): Promise<void> {
  await db().blobs.delete(path);
  await removeBlob(path);
}

export async function deleteBlobsByOwner(ownerId: string): Promise<void> {
  const rows = await db().blobs.where("ownerId").equals(ownerId).toArray();
  await db().blobs.where("ownerId").equals(ownerId).delete();
  await Promise.all(rows.map((r) => removeBlob(r.path)));
}
