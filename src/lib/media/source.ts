"use client";

import { db } from "@/lib/db/db";
import type { MediaItem, StoredFileHandle } from "@/lib/types";
import { readAsBlob } from "@/lib/storage/opfs";
import { uid } from "@/lib/util";
import { putBlob } from "@/lib/storage/blobStore";

export const ACCEPTED_EXT = ["mp3", "m4a", "wav", "ogg", "mp4", "webm", "mov"];
export const ACCEPT_ATTR =
  "audio/*,video/*," + ACCEPTED_EXT.map((e) => "." + e).join(",");

export function fsAccessSupported(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

type PermState = "granted" | "denied" | "prompt";

async function queryPerm(handle: FileSystemFileHandle): Promise<PermState> {
  // @ts-expect-error queryPermission no está tipado en todos los lib.dom
  return handle.queryPermission?.({ mode: "read" }) ?? "prompt";
}
export async function requestHandlePermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  // @ts-expect-error requestPermission no tipado
  const res = await handle.requestPermission?.({ mode: "read" });
  return res === "granted";
}

/** Elige un archivo con File System Access API y persiste el handle. */
export async function pickWithFsAccess(): Promise<{
  handleId: string;
  file: File;
} | null> {
  // @ts-expect-error showOpenFilePicker no tipado
  const [handle]: FileSystemFileHandle[] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: "Audio y vídeo",
        accept: {
          "audio/*": ACCEPTED_EXT.filter((e) =>
            ["mp3", "m4a", "wav", "ogg"].includes(e),
          ).map((e) => "." + e),
          "video/*": ["mp4", "webm", "mov"].map((e) => "." + e),
        },
      },
    ],
  });
  if (!handle) return null;
  const file = await handle.getFile();
  const id = uid("fh");
  const row: StoredFileHandle = {
    id,
    handle,
    fileName: file.name,
    createdAt: Date.now(),
  };
  await db().fileHandles.put(row);
  return { handleId: id, file };
}

/** Copia un archivo a OPFS (opción "Importar a la app"). */
export async function importToOpfs(
  file: Blob,
  fileName: string,
  mediaId: string,
): Promise<{ path: string; bytes: number }> {
  const ext = fileName.toLowerCase().split(".").pop() || "bin";
  const path = `media/${mediaId}/source.${ext}`;
  return putBlob(path, file, "media", mediaId);
}

export type ResolvedSource =
  | { kind: "ready"; file: Blob; mime: string }
  | { kind: "needs-permission"; handle: FileSystemFileHandle; fileName: string }
  | { kind: "missing"; reason: string };

/** Obtiene el Blob de un MediaItem para reproducir / decodificar. */
export async function resolveMediaSource(
  media: MediaItem,
): Promise<ResolvedSource> {
  const src = media.source;

  if (src.kind === "opfs") {
    try {
      const file = await readAsBlob(src.path, src.mime);
      return { kind: "ready", file, mime: src.mime };
    } catch {
      return { kind: "missing", reason: "El archivo importado ya no está en el dispositivo." };
    }
  }

  if (src.kind === "local-file") {
    if (!src.handleId) {
      return {
        kind: "missing",
        reason:
          "Este medio se usó solo en una sesión. Vuelve a seleccionar el archivo original.",
      };
    }
    const row = await db().fileHandles.get(src.handleId);
    if (!row) {
      return { kind: "missing", reason: "Se perdió la referencia al archivo." };
    }
    const perm = await queryPerm(row.handle);
    if (perm !== "granted") {
      return { kind: "needs-permission", handle: row.handle, fileName: row.fileName };
    }
    try {
      const file = await row.handle.getFile();
      return { kind: "ready", file, mime: file.type || src.mime };
    } catch {
      return {
        kind: "missing",
        reason: "No se pudo abrir el archivo original. ¿Se movió o borró?",
      };
    }
  }

  return { kind: "missing", reason: "Fuente no disponible en esta versión." };
}
