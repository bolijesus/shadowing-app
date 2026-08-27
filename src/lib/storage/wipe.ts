"use client";

import { wipeOpfs } from "./opfs";

const API_KEYS_LS = "shadowing.apiKeys";

export interface WipeOptions {
  /** Si false, se conservan las API keys del navegador. */
  wipeApiKeys: boolean;
  onProgress?: (step: string) => void;
}

/**
 * Borra todos los datos: Cache Storage + OPFS + IndexedDB + localStorage.
 * Orden fijo, con progreso; recarga al final (plan D2, §10).
 */
export async function wipeAllData(opts: WipeOptions): Promise<void> {
  const p = opts.onProgress ?? (() => {});

  p("Vaciando cachés…");
  if ("caches" in globalThis) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }

  p("Borrando archivos locales…");
  await wipeOpfs().catch(() => {});

  p("Borrando bases de datos…");
  const dbs = (await indexedDB.databases?.()) ?? [{ name: "shadowing" }];
  await Promise.all(
    dbs
      .map((d) => d.name)
      .filter((n): n is string => !!n)
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
  );

  p("Limpiando preferencias…");
  const preservedKeys = opts.wipeApiKeys ? null : localStorage.getItem(API_KEYS_LS);
  localStorage.clear();
  if (preservedKeys !== null) localStorage.setItem(API_KEYS_LS, preservedKeys);

  p("Recargando…");
  location.reload();
}
