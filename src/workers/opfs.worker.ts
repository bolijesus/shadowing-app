/// <reference lib="webworker" />
import * as Comlink from "comlink";

/**
 * Worker único para toda la E/S de blobs en OPFS (plan D2).
 * Usa createSyncAccessHandle (solo disponible en Worker) para evitar
 * depender de createWritable, ausente en Safari < 17.
 */

async function dirHandle(
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  const parts = path.split("/").filter(Boolean);
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function fileHandle(
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error(`Ruta OPFS inválida: ${path}`);
  const dir = await dirHandle(parts.join("/"), create);
  return dir.getFileHandle(name, { create });
}

const api = {
  async write(path: string, data: ArrayBuffer): Promise<number> {
    const fh = await fileHandle(path, true);
    const access = await fh.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(new Uint8Array(data), { at: 0 });
      access.flush();
      return access.getSize();
    } finally {
      access.close();
    }
  },

  async read(path: string): Promise<ArrayBuffer> {
    const fh = await fileHandle(path, false);
    const file = await fh.getFile();
    return file.arrayBuffer();
  },

  async exists(path: string): Promise<boolean> {
    try {
      await fileHandle(path, false);
      return true;
    } catch {
      return false;
    }
  },

  async remove(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    try {
      const dir = await dirHandle(parts.join("/"), false);
      await dir.removeEntry(name, { recursive: true });
    } catch {
      /* ya no existe */
    }
  },

  /** Lista recursiva de rutas de archivo bajo `prefix` (vacío = raíz). */
  async list(prefix = ""): Promise<{ path: string; bytes: number }[]> {
    const out: { path: string; bytes: number }[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, base: string) => {
      // @ts-expect-error entries() es asíncrono iterable en OPFS
      for await (const [name, handle] of dir.entries()) {
        const p = base ? `${base}/${name}` : name;
        if (handle.kind === "file") {
          const f = await (handle as FileSystemFileHandle).getFile();
          out.push({ path: p, bytes: f.size });
        } else {
          await walk(handle as FileSystemDirectoryHandle, p);
        }
      }
    };
    try {
      const start = prefix
        ? await dirHandle(prefix, false)
        : await navigator.storage.getDirectory();
      await walk(start, prefix);
    } catch {
      /* prefijo inexistente */
    }
    return out;
  },

  /** Borra absolutamente todo el contenido de OPFS. */
  async wipeAll(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    // @ts-expect-error entries() asíncrono iterable
    for await (const [name] of root.entries()) {
      await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
  },
};

export type OpfsWorkerApi = typeof api;
Comlink.expose(api);
