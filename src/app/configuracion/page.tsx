"use client";

import * as React from "react";
import {
  Card,
  Eyebrow,
  Field,
  Select,
  TextInput,
} from "@/components/ui/primitives";
import { useSettings } from "@/lib/stores/settings";
import { AiProviders } from "@/components/settings/AiProviders";

const LANGS = [
  "en-US",
  "en-GB",
  "es-ES",
  "es-419",
  "fr-FR",
  "de-DE",
  "it-IT",
  "pt-BR",
  "ja-JP",
  "ko-KR",
  "zh-CN",
];

export default function SettingsPage() {
  const s = useSettings();
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  if (!hydrated) return null;

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Ajustes</Eyebrow>
        <h1 className="h-display mt-1 text-2xl">Preferencias de práctica</h1>
      </div>

      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Idioma objetivo">
          <Select
            value={s.targetLanguage}
            onChange={(e) => s.set("targetLanguage", e.target.value)}
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dialecto para el IPA" hint="Se usará al mostrar la transcripción fonética.">
          <TextInput
            value={s.ipaDialect}
            onChange={(e) => s.set("ipaDialect", e.target.value)}
          />
        </Field>
        <Field label="Velocidad por defecto">
          <Select
            value={String(s.defaultRate)}
            onChange={(e) => s.set("defaultRate", Number(e.target.value))}
          >
            {[0.7, 0.85, 1, 1.15].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vueltas por práctica">
          <TextInput
            type="number"
            min={1}
            max={10}
            value={s.rounds}
            onChange={(e) => s.set("rounds", Number(e.target.value))}
          />
        </Field>
        <Field label="Umbral de aprobado">
          <TextInput
            type="number"
            min={0}
            max={100}
            value={s.passThreshold}
            onChange={(e) => s.set("passThreshold", Number(e.target.value))}
          />
        </Field>
        <Field label="Escalera de texto por defecto">
          <Select
            value={s.showText}
            onChange={(e) =>
              s.set("showText", e.target.value as typeof s.showText)
            }
          >
            <option value="always">Siempre visible</option>
            <option value="fade">Escalera (se atenúa)</option>
            <option value="never">Nunca</option>
          </Select>
        </Field>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Tema">
          <Select
            value={s.theme}
            onChange={(e) => s.set("theme", e.target.value as typeof s.theme)}
          >
            <option value="system">Del sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </Select>
        </Field>
        <Field label="Tamaño de letra">
          <Select
            value={String(s.fontSize)}
            onChange={(e) => s.set("fontSize", Number(e.target.value))}
          >
            {[14, 15, 16, 18, 20].map((px) => (
              <option key={px} value={px}>
                {px} px
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Auriculares"
          hint="Con auriculares se desactiva la cancelación de eco al grabar."
        >
          <Select
            value={
              s.usesHeadphones === null
                ? "ask"
                : s.usesHeadphones
                  ? "yes"
                  : "no"
            }
            onChange={(e) =>
              s.set(
                "usesHeadphones",
                e.target.value === "ask"
                  ? null
                  : e.target.value === "yes",
              )
            }
          >
            <option value="ask">Preguntar</option>
            <option value="yes">Sí, siempre</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field
          label="Compensación de latencia del micro (ms)"
          hint="Se calibra automáticamente en la fase de análisis. Vacío = automático."
        >
          <TextInput
            type="number"
            value={s.micLatencyOffsetMs ?? ""}
            onChange={(e) =>
              s.set(
                "micLatencyOffsetMs",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </Field>
      </Card>

      <AiProviders />
    </div>
  );
}
