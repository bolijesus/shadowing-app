"use client";

import * as React from "react";
import {
  Button,
  Card,
  Eyebrow,
  Field,
  Select,
  TextInput,
} from "@/components/ui/primitives";
import {
  type Capability,
  type KeystoreData,
  type ProviderConfig,
  clearKeystore,
  disableEncryption,
  enableEncryption,
  getKeystore,
  isEncrypted,
  lock,
  needsUnlock,
  saveKeystore,
  unlock,
} from "@/lib/crypto/keystore";
import {
  PROVIDERS,
  getProvider,
  providersFor,
  testConnection,
  type TestResult,
} from "@/lib/ai/providers";
import {
  onVoicesReady,
  speakWithBrowser,
  cancelBrowserSpeech,
} from "@/lib/tts/browser";
import { useConfirm } from "@/components/ui/Dialog";

const CAP_LABEL: Record<Capability, string> = {
  tts: "Voz generada (TTS)",
  asr: "Reconocimiento de voz (ASR)",
  llm: "Modelo de lenguaje (LLM)",
};

export function AiProviders() {
  const [ready, setReady] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [encrypted, setEncrypted] = React.useState(false);
  const [store, setStore] = React.useState<KeystoreData>({
    providers: {},
    selected: {},
  });
  const [pass, setPass] = React.useState("");
  const [pass2, setPass2] = React.useState("");
  const [unlockPass, setUnlockPass] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const { confirm, node: confirmNode } = useConfirm();

  const refresh = React.useCallback(() => {
    setEncrypted(isEncrypted());
    setLocked(needsUnlock());
    const s = getKeystore();
    if (s) setStore(structuredClone(s));
    setReady(true);
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function persist(next: KeystoreData) {
    setStore(next);
    try {
      await saveKeystore(next);
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  }

  function setSelected(cap: Capability, providerId: string) {
    void persist({ ...store, selected: { ...store.selected, [cap]: providerId } });
  }
  function setConfig(providerId: string, patch: Partial<ProviderConfig>) {
    void persist({
      ...store,
      providers: {
        ...store.providers,
        [providerId]: { ...store.providers[providerId], ...patch },
      },
    });
  }

  if (!ready) return null;

  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>Proveedores de IA</Eyebrow>
        <h2 className="h-display mt-1 text-xl">Voz, dictado y texto</h2>
      </div>

      <div className="rounded-card border-2 border-accent bg-accent-tint p-4 text-sm text-accent-ink">
        <p className="font-bold">Aviso honesto</p>
        <p className="mt-1">
          Una API key guardada en el navegador es legible por cualquiera con
          acceso a este dispositivo y viaja en las peticiones desde el cliente.
          Usa una key con cuota baja dedicada a esta app y restríngela por
          dominio/referente. Si no quieres exponerla, configura la URL de un{" "}
          <strong>proxy propio</strong> por proveedor.
        </p>
      </div>

      {/* Cifrado en reposo */}
      <Card className="space-y-3">
        <p className="font-bold text-ink">Cifrado de las claves</p>
        {locked ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">
              Las claves están cifradas. Introduce la passphrase para esta sesión.
            </p>
            <div className="flex gap-2">
              <TextInput
                type="password"
                value={unlockPass}
                onChange={(e) => setUnlockPass(e.target.value)}
                placeholder="Passphrase"
              />
              <Button
                variant="primary"
                onClick={async () => {
                  const ok = await unlock(unlockPass);
                  setUnlockPass("");
                  if (ok) refresh();
                  else setMsg("Passphrase incorrecta.");
                }}
              >
                Desbloquear
              </Button>
            </div>
          </div>
        ) : encrypted ? (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-ok/15 px-3 py-1 text-xs font-bold text-ok">
              Cifrado activado y desbloqueado
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                lock();
                refresh();
              }}
            >
              Bloquear ahora
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await disableEncryption();
                refresh();
              }}
            >
              Quitar cifrado
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">
              Opcional: cifra las claves con AES-GCM (clave derivada con PBKDF2).
              Se pedirá la passphrase una vez por sesión.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <TextInput
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="Passphrase"
              />
              <TextInput
                type="password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                placeholder="Repite la passphrase"
              />
            </div>
            <Button
              variant="secondary"
              disabled={pass.length < 6 || pass !== pass2}
              onClick={async () => {
                await enableEncryption(pass);
                setPass("");
                setPass2("");
                refresh();
              }}
            >
              Activar cifrado
            </Button>
          </div>
        )}
      </Card>

      {msg && (
        <p className="rounded-control border-2 border-accent bg-accent-tint px-3 py-2 text-sm text-accent-ink">
          {msg}
        </p>
      )}

      {!locked &&
        (["tts", "asr", "llm"] as Capability[]).map((cap) => {
          const options = providersFor(cap);
          const selectedId =
            store.selected[cap] ??
            (cap === "tts" ? "browser" : cap === "asr" ? "whisper-local" : "openai");
          return (
            <Card key={cap} className="space-y-3">
              <Field label={CAP_LABEL[cap]}>
                <Select
                  value={selectedId}
                  onChange={(e) => setSelected(cap, e.target.value)}
                >
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.keyless ? " · sin key" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <ProviderEditor
                providerId={selectedId}
                capability={cap}
                config={store.providers[selectedId] ?? {}}
                onChange={(patch) => setConfig(selectedId, patch)}
              />
            </Card>
          );
        })}

      <Button
        variant="ghost"
        onClick={async () => {
          if (
            await confirm({
              title: "Borrar claves",
              body: "Se borrarán todas las API keys y la configuración de proveedores guardadas en este dispositivo.",
              confirmLabel: "Borrar",
            })
          ) {
            clearKeystore();
            refresh();
          }
        }}
      >
        Borrar todas las claves guardadas
      </Button>
      {confirmNode}
      <p className="text-xs text-ink-soft">
        Por defecto la app usa la voz del navegador (sin key) y, más adelante,
        Whisper local para el dictado. No necesitas configurar nada para
        practicar.
      </p>
    </div>
  );
}

function ProviderEditor({
  providerId,
  capability,
  config,
  onChange,
}: {
  providerId: string;
  capability: Capability;
  config: ProviderConfig;
  onChange: (patch: Partial<ProviderConfig>) => void;
}) {
  const meta = getProvider(providerId);
  const [reveal, setReveal] = React.useState(false);
  const [test, setTest] = React.useState<TestResult | "loading" | null>(null);
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);

  React.useEffect(() => {
    if (providerId !== "browser") return;
    return onVoicesReady(setVoices);
  }, [providerId]);

  if (!meta) return null;

  const models = meta.models.filter((m) => {
    if (capability === "tts") return /tts/i.test(m);
    if (capability === "asr") return /whisper|transcribe|nova/i.test(m);
    return !/tts|whisper|transcribe|nova/i.test(m);
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">{meta.docsNote}</p>

      {providerId === "browser" && capability === "tts" && (
        <div className="space-y-2">
          <Field label="Voz del navegador">
            <Select
              value={config.model ?? ""}
              onChange={(e) => onChange({ model: e.target.value })}
            >
              <option value="">Automática (según idioma)</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              cancelBrowserSpeech();
              void speakWithBrowser(
                "This is a preview of the selected voice.",
                { voiceURI: config.model || undefined },
              );
            }}
          >
            Probar voz
          </Button>
        </div>
      )}

      {!meta.keyless && (
        <>
          <Field label="API key" hint={meta.keyHint}>
            <div className="flex gap-2">
              <TextInput
                type={reveal ? "text" : "password"}
                value={config.apiKey ?? ""}
                onChange={(e) => onChange({ apiKey: e.target.value })}
                placeholder={meta.keyHint}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="secondary"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Ocultar" : "Mostrar"}
              >
                {reveal ? "Ocultar" : "Ver"}
              </Button>
            </div>
          </Field>

          <Field
            label="Proxy propio (opcional)"
            hint="Si lo indicas, las peticiones van aquí y la key no se expone en el cliente."
          >
            <TextInput
              value={config.proxyUrl ?? ""}
              onChange={(e) => onChange({ proxyUrl: e.target.value })}
              placeholder="https://mi-proxy.ejemplo/api"
            />
          </Field>
        </>
      )}

      {models.length > 0 && (
        <Field label="Modelo">
          <Select
            value={config.model ?? models[0]}
            onChange={(e) => onChange({ model: e.target.value })}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={async () => {
            setTest("loading");
            setTest(await testConnection(providerId, config));
          }}
        >
          Probar conexión
        </Button>
        {test && test !== "loading" && (
          <span
            className={
              test.ok
                ? "text-sm font-semibold text-ok"
                : "text-sm font-semibold text-accent-ink"
            }
          >
            {test.detail}
          </span>
        )}
        {test === "loading" && (
          <span className="text-sm text-ink-soft">Comprobando…</span>
        )}
      </div>
    </div>
  );
}
