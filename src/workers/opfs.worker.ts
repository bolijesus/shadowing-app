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

/**
 * Una cola por ruta: dos operaciones sobre el MISMO archivo nunca se solapan.
 *
 * OPFS solo permite un access handle abierto por archivo. Como Comlink lanza
 * las llamadas en paralelo, bastaba con que dos efectos pidieran el mismo
 * análisis a la vez para que la segunda escritura reventara con "Access
 * Handles cannot be created if there is another open Access Handle". Encolar
 * por ruta lo elimina, y no serializa archivos distintos, que sí pueden ir a
 * la vez.
 */
const chains = new Map<string, Promise<void>>();

function serial<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(path) ?? Promise.resolve();
  // Se encadena pase lo que pase con la anterior: un fallo no debe bloquear
  // para siempre las operaciones siguientes sobre ese archivo.
  const run = prev.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(path, settled);
  void settled.then(() => {
    if (chains.get(path) === settled) chains.delete(path);
  });
  return run;
}

const api = {
  write(path: string, data: ArrayBuffer): Promise<number> {
    return serial(path, async () => {
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
    });
  },

  read(path: string): Promise<ArrayBuffer> {
    // También va por la cola: leer un archivo a medio escribir daría un
    // análisis truncado, que es peor que esperar unos milisegundos.
    return serial(path, async () => {
      const fh = await fileHandle(path, false);
      const file = await fh.getFile();
      return file.arrayBuffer();
    });
  },

  async exists(path: string): Promise<boolean> {
    try {
      await fileHandle(path, false);
      return true;
    } catch {
      return false;
    }
  },

  remove(path: string): Promise<void> {
    return serial(path, async () => {
      const parts = path.split("/").filter(Boolean);
      const name = parts.pop();
      if (!name) return;
      try {
        const dir = await dirHandle(parts.join("/"), false);
        await dir.removeEntry(name, { recursive: true });
      } catch {
        /* ya no existe */
      }
    });
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
