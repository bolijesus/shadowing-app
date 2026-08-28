"use client";

/**
 * Almacén de claves de API en el navegador (§11).
 * - Se guardan en localStorage bajo `shadowing.apiKeys`.
 * - Cifrado opcional en reposo con AES-GCM; la clave se deriva de una
 *   passphrase con PBKDF2 y solo vive en memoria durante la sesión.
 * - Nunca se envían a ningún servidor propio.
 */

const LS_KEY = "shadowing.apiKeys";
const PBKDF2_ITERS = 210_000;

export type Capability = "tts" | "llm";

export interface ProviderConfig {
  apiKey?: string;
  /** Modelo por capacidad: el de LLM no sirve para generar voz. */
  models?: Partial<Record<Capability, string>>;
  /** Compatibilidad con configuraciones antiguas de un solo modelo. */
  model?: string;
  /** Endpoint proxy propio para no exponer la key en el cliente. */
  proxyUrl?: string;
}

/** Modelo efectivo de un proveedor para una capacidad concreta. */
export function modelFor(
  cfg: ProviderConfig | undefined,
  cap: Capability,
): string | undefined {
  return cfg?.models?.[cap] ?? undefined;
}

export interface KeystoreData {
  /** providerId -> config */
  providers: Record<string, ProviderConfig>;
  /** capability -> providerId seleccionado */
  selected: Partial<Record<Capability, string>>;
}

interface Envelope {
  v: 1;
  enc: boolean;
  salt?: string;
  iv?: string;
  /** JSON en claro (enc=false) o base64 del ciphertext (enc=true). */
  data: string;
}

const EMPTY: KeystoreData = { providers: {}, selected: {} };

let memData: KeystoreData | null = null;
let memKey: CryptoKey | null = null;

/* ---------- helpers base64 ---------- */
const b64 = {
  enc(buf: ArrayBufferLike | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return btoa(s);
  },
  dec(s: string): Uint8Array {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  },
};

function readEnvelope(): Envelope | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Envelope;
  } catch {
    return null;
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ---------- estado ---------- */

export function isEncrypted(): boolean {
  return readEnvelope()?.enc === true;
}

export function isUnlocked(): boolean {
  return memData !== null;
}

export function needsUnlock(): boolean {
  return isEncrypted() && !isUnlocked();
}

/** Devuelve el almacén si está accesible (claro o ya desbloqueado). */
export function getKeystore(): KeystoreData | null {
  if (memData) return memData;
  const env = readEnvelope();
  if (!env) return { ...EMPTY };
  if (!env.enc) {
    try {
      memData = JSON.parse(env.data) as KeystoreData;
      return memData;
    } catch {
      return { ...EMPTY };
    }
  }
  return null; // cifrado y bloqueado
}

export async function unlock(passphrase: string): Promise<boolean> {
  const env = readEnvelope();
  if (!env || !env.enc || !env.salt || !env.iv) return false;
  try {
    const key = await deriveKey(passphrase, b64.dec(env.salt));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64.dec(env.iv) as BufferSource },
      key,
      b64.dec(env.data) as BufferSource,
    );
    memData = JSON.parse(new TextDecoder().decode(plain)) as KeystoreData;
    memKey = key;
    return true;
  } catch {
    return false;
  }
}

export function lock(): void {
  memData = null;
  memKey = null;
}

async function persist(data: KeystoreData, encWithKey: CryptoKey | null, salt?: Uint8Array) {
  memData = data;
  if (encWithKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      encWithKey,
      new TextEncoder().encode(JSON.stringify(data)),
    );
    const env: Envelope = {
      v: 1,
      enc: true,
      salt: b64.enc(salt ?? new Uint8Array()),
      iv: b64.enc(iv),
      data: b64.enc(ct),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(env));
  } else {
    const env: Envelope = { v: 1, enc: false, data: JSON.stringify(data) };
    localStorage.setItem(LS_KEY, JSON.stringify(env));
  }
}

/** Guarda el almacén con el mismo modo de cifrado actual. */
export async function saveKeystore(data: KeystoreData): Promise<void> {
  if (isEncrypted()) {
    if (!memKey) throw new Error("Introduce la passphrase antes de guardar.");
    const env = readEnvelope()!;
    await persist(data, memKey, b64.dec(env.salt!));
  } else {
    await persist(data, null);
  }
}

export async function enableEncryption(passphrase: string): Promise<void> {
  const data = getKeystore() ?? { ...EMPTY };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  memKey = key;
  await persist(data, key, salt);
}

export async function disableEncryption(): Promise<void> {
  const data = getKeystore();
  if (!data) throw new Error("Desbloquea primero con la passphrase.");
  memKey = null;
  await persist(data, null);
}

export function clearKeystore(): void {
  localStorage.removeItem(LS_KEY);
  lock();
}
