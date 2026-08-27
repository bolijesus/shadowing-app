"use client";

/**
 * Cache en memoria de archivos "solo esta sesión": sobrevive a la navegación
 * del cliente pero no a una recarga dura (semántica del prompt §4.1).
 */
const cache = new Map<string, File | Blob>();

export const mediaFileCache = {
  set(mediaId: string, file: File | Blob) {
    cache.set(mediaId, file);
  },
  get(mediaId: string): File | Blob | undefined {
    return cache.get(mediaId);
  },
  has(mediaId: string) {
    return cache.has(mediaId);
  },
  delete(mediaId: string) {
    cache.delete(mediaId);
  },
};
