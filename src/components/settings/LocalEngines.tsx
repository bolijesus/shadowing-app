"use client";

import * as React from "react";
import { Button, Card, Eyebrow, Field, Pill, SelectField } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/confirm";
import { deleteLocalModels, localModelUsage } from "@/lib/asr/models";
import { warmupLocal, selectedWhisperModel } from "@/lib/asr";
import { WHISPER_MODELS, whisperModelInfo } from "@/lib/asr/types";
import { getKeystore, saveKeystore } from "@/lib/crypto/keystore";
import { fmtBytes } from "@/lib/util";

/**
 * Estado de motores locales (§11): qué hay descargado, cuánto ocupa, y
 * botones de descargar y borrar. Antes no había forma de saberlo ni de
 * liberar el espacio sin borrarlo todo.
 */
export function LocalEngines() {
  const [usage, setUsage] = React.useState<{
    bytes: number;
    files: number;
    models: string[];
  } | null>(null);
  const [model, setModel] = React.useState(selectedWhisperModel());
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [device, setDevice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { confirm, node } = useConfirm();

  const refresh = React.useCallback(async () => {
    setUsage(await localModelUsage().catch(() => null));
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function pickModel(id: string) {
    setModel(id);
    const ks = getKeystore();
    if (!ks) return;
    const prev = ks.providers["whisper-local"] ?? {};
    await saveKeystore({
      ...ks,
      providers: {
        ...ks.providers,
        "whisper-local": {
          ...prev,
          models: { ...prev.models, asr: id },
        },
      },
    });
  }

  async function download() {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const dev = await warmupLocal((p) =>
        setProgress(typeof p.progress === "number" ? Math.round(p.progress) : null),
      );
      setDevice(dev);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const info = whisperModelInfo(model);
  const downloaded = (usage?.files ?? 0) > 0;

  return (
    <Card className="space-y-4">
      <div>
        <Eyebrow>Motores locales</Eyebrow>
        <h2 className="h-display mt-1 text-xl">Reconocimiento de voz</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Whisper funciona dentro del navegador: tu voz no sale del
          dispositivo y no cuesta nada. Se descarga una vez y queda guardado.
        </p>
      </div>

      <Field
        label="Modelo"
        hint={
          info
            ? `Ocupa unos ${info.mb} MB.${
                info.englishOnly ? " Solo transcribe inglés." : ""
              }`
            : undefined
        }
      >
        <SelectField
          aria-label="Modelo de Whisper"
          value={model}
          onValueChange={(v) => void pickModel(v)}
          options={WHISPER_MODELS.map((m) => ({
            value: m.id,
            label: `${m.label} · ${m.mb} MB`,
          }))}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={downloaded ? "ok" : "neutral"}>
          {downloaded ? "Descargado" : "Sin descargar"}
        </Pill>
        {usage && usage.bytes > 0 && (
          <span className="text-sm text-ink-soft">
            {fmtBytes(usage.bytes)} en {usage.files} archivos
          </span>
        )}
        {device && (
          <Pill tone="data">
            {device === "webgpu" ? "Acelerado por GPU" : "CPU (WASM)"}
          </Pill>
        )}
      </div>

      {usage && usage.models.length > 0 && (
        <ul className="space-y-1 text-xs text-ink-soft">
          {usage.models.map((m) => (
            <li key={m} className="font-mono">
              {m}
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p className="text-sm font-semibold text-ink-soft">
          {progress !== null
            ? `Descargando… ${progress}%`
            : "Preparando el modelo…"}
        </p>
      )}
      {error && (
        <p className="rounded-lg border-l-4 border-brand bg-brand-tint px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={download} disabled={busy}>
          {downloaded ? "Volver a preparar" : "Descargar ahora"}
        </Button>
        {downloaded && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: "Borrar modelos",
                  body: "Se liberará el espacio. Volverán a descargarse la próxima vez que transcribas.",
                  confirmLabel: "Borrar",
                  tone: "danger",
                })
              ) {
                await deleteLocalModels();
                await refresh();
              }
            }}
          >
            Borrar del dispositivo
          </Button>
        )}
      </div>

      <p className="text-xs text-ink-soft">
        No hace falta descargarlo aquí: si no está, se descarga solo la primera
        vez que grabes una toma. Este botón sirve para hacerlo con wifi y no
        esperar luego.
      </p>

      {node}
    </Card>
  );
}
