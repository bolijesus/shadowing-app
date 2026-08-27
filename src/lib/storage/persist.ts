"use client";

/**
 * Solicita almacenamiento persistente tras la primera interacción real,
 * para que el navegador no borre los datos por falta de espacio (§10).
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  if (await navigator.storage.persisted?.()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
