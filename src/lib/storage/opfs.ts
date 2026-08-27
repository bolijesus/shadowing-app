"use client";

import * as Comlink from "comlink";
import type { OpfsWorkerApi } from "@/workers/opfs.worker";

/**
 * Fachada de OPFS en el hilo principal. Proxya al worker único.
 * El hilo principal nunca escribe OPFS directamente (plan D2).
 */

let _proxy: Comlink.Remote<OpfsWorkerApi> | null = null;

function proxy(): Comlink.Remote<OpfsWorkerApi> {
  if (!_proxy) {
    const worker = new Worker(
      new URL("../../workers/opfs.worker.ts", import.meta.url),
      { type: "module", name: "opfs" },
    );
    _proxy = Comlink.wrap<OpfsWorkerApi>(worker);
  }
  return _proxy;
}

export function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

export async function writeBlob(
  path: string,
  data: ArrayBuffer | Blob,
): Promise<number> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  return proxy().write(path, Comlink.transfer(buf, [buf]));
}

export async function readBlob(path: string): Promise<ArrayBuffer> {
  return proxy().read(path);
}

export async function readAsBlob(path: string, mime: string): Promise<Blob> {
  const buf = await proxy().read(path);
  return new Blob([buf], { type: mime });
}

export async function readAsObjectURL(
  path: string,
  mime: string,
): Promise<string> {
  return URL.createObjectURL(await readAsBlob(path, mime));
}

export async function blobExists(path: string): Promise<boolean> {
  return proxy().exists(path);
}

export async function removeBlob(path: string): Promise<void> {
  return proxy().remove(path);
}

export async function listBlobs(
  prefix = "",
): Promise<{ path: string; bytes: number }[]> {
  return proxy().list(prefix);
}

export async function wipeOpfs(): Promise<void> {
  return proxy().wipeAll();
}
