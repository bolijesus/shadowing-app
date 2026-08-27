"use client";

/**
 * TTS del navegador (speechSynthesis): gratis, sin key, calidad menor.
 * Es el proveedor por defecto para que la app funcione sin configurar nada.
 */

export function browserTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (!browserTtsSupported()) return [];
  return window.speechSynthesis.getVoices();
}

/** Las voces cargan asíncronamente en algunos navegadores. */
export function onVoicesReady(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!browserTtsSupported()) return () => {};
  const emit = () => cb(window.speechSynthesis.getVoices());
  emit();
  window.speechSynthesis.addEventListener("voiceschanged", emit);
  return () =>
    window.speechSynthesis.removeEventListener("voiceschanged", emit);
}

export interface BrowserSpeakOptions {
  voiceURI?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}

export function cancelBrowserSpeech(): void {
  if (browserTtsSupported()) window.speechSynthesis.cancel();
}

export function speakWithBrowser(
  text: string,
  opts: BrowserSpeakOptions = {},
): Promise<void> {
  if (!browserTtsSupported()) {
    return Promise.reject(new Error("Este navegador no tiene síntesis de voz."));
  }
  return new Promise((resolve, reject) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    if (opts.voiceURI) {
      const v = voices.find((x) => x.voiceURI === opts.voiceURI);
      if (v) u.voice = v;
    }
    if (opts.lang) u.lang = opts.lang;
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.onend = () => resolve();
    u.onerror = (e) =>
      e.error === "interrupted" || e.error === "canceled"
        ? resolve()
        : reject(new Error(`Síntesis de voz: ${e.error}`));
    window.speechSynthesis.speak(u);
  });
}
