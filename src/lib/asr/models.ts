"use client";

/**
 * Tamaño y borrado de los modelos locales (§10, §11).
 *
 * transformers.js los guarda en Cache Storage, no en OPFS, así que el libro
 * de bytes de Dexie —que alimenta el desglose por categoría— no los ve. Por
 * eso este caché se consulta aparte.
 */

const CACHE_HINTS = ["transformers", "onnx", "huggingface"];

async function modelCacheNames(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  const all = await caches.keys();
  return all.filter((n) =>
    CACHE_HINTS.some((h) => n.toLowerCase().includes(h)),
  );
}

export interface LocalModelUsage {
  bytes: number;
  files: number;
  /** Nombres de modelo deducidos de las URLs cacheadas. */
  models: string[];
}

export async function localModelUsage(): Promise<LocalModelUsage> {
  let bytes = 0;
  let files = 0;
  const models = new Set<string>();

  for (const name of await modelCacheNames()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      files++;
      try {
        bytes += (await res.clone().blob()).size;
      } catch {
        /* respuesta ilegible: no suma, pero tampoco rompe */
      }
      // .../<org>/<modelo>/resolve/... -> "<org>/<modelo>"
      const m = /\/([\w.-]+\/[\w.-]+)\/resolve\//.exec(req.url);
      if (m) models.add(m[1]!);
    }
  }
  return { bytes, files, models: [...models] };
}

export async function hasLocalModel(): Promise<boolean> {
  return (await localModelUsage()).files > 0;
}

/** "Borrar modelos de IA descargados" (§10). */
export async function deleteLocalModels(): Promise<number> {
  const names = await modelCacheNames();
  for (const n of names) await caches.delete(n);
  return names.length;
}
