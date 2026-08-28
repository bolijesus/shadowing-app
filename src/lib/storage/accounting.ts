"use client";

import { db } from "@/lib/db/db";
import type { BlobCategory, BlobRecord } from "@/lib/types";

export const CATEGORY_LABEL: Record<BlobCategory, string> = {
  media: "Medios importados",
  tts: "Voces generadas",
  recording: "Grabaciones",
  export: "Recortes exportados",
  analysis: "Análisis y picos",
  model: "Modelos de IA descargados",
  transcript: "Transcripciones",
};

export interface StorageBreakdown {
  quota: number;
  usage: number;
  ledgerTotal: number;
  overhead: number;
  byCategory: { category: BlobCategory; label: string; bytes: number; count: number }[];
  items: BlobRecord[];
}

/**
 * Desglose real por categoría sumando el libro de bytes (Dexie).
 * navigator.storage.estimate() solo aporta el titular usado/cuota.
 */
export async function getStorageBreakdown(): Promise<StorageBreakdown> {
  const rows = await db().blobs.toArray();
  const est =
    typeof navigator !== "undefined" && navigator.storage?.estimate
      ? await navigator.storage.estimate()
      : { quota: 0, usage: 0 };

  const map = new Map<BlobCategory, { bytes: number; count: number }>();
  for (const r of rows) {
    const cur = map.get(r.category) ?? { bytes: 0, count: 0 };
    cur.bytes += r.bytes;
    cur.count += 1;
    map.set(r.category, cur);
  }

  const byCategory = (Object.keys(CATEGORY_LABEL) as BlobCategory[]).map(
    (category) => ({
      category,
      label: CATEGORY_LABEL[category],
      bytes: map.get(category)?.bytes ?? 0,
      count: map.get(category)?.count ?? 0,
    }),
  );

  const ledgerTotal = rows.reduce((s, r) => s + r.bytes, 0);
  const usage = est.usage ?? 0;

  return {
    quota: est.quota ?? 0,
    usage,
    ledgerTotal,
    overhead: Math.max(0, usage - ledgerTotal),
    byCategory,
    items: rows.sort((a, b) => b.createdAt - a.createdAt),
  };
}
