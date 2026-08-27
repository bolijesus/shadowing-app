"use client";

import * as React from "react";
import {
  Card,
  Eyebrow,
  Field,
  SelectField,
  TextInput,
} from "@/components/ui/primitives";
import { useSettings } from "@/lib/stores/settings";
import { AiProviders } from "@/components/settings/AiProviders";

const LANGS = [
  ["en-US", "Inglés (EE. UU.)"],
  ["en-GB", "Inglés (Reino Unido)"],
  ["es-ES", "Español (España)"],
  ["es-419", "Español (Latinoamérica)"],
  ["fr-FR", "Francés"],
  ["de-DE", "Alemán"],
  ["it-IT", "Italiano"],
  ["pt-BR", "Portugués (Brasil)"],
  ["ja-JP", "Japonés"],
  ["ko-KR", "Coreano"],
  ["zh-CN", "Chino (mandarín)"],
] as const;

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
          <SelectField
            aria-label="Idioma objetivo"
            value={s.targetLanguage}
            onValueChange={(v) => s.set("targetLanguage", v)}
            options={LANGS.map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field
          label="Dialecto para el IPA"
          hint="Se usará al mostrar la transcripción fonética."
        >
          <TextInput
            value={s.ipaDialect}
            onChange={(e) => s.set("ipaDialect", e.target.value)}
          />
        </Field>
        <Field label="Velocidad por defecto">
          <SelectField
            aria-label="Velocidad por defecto"
            value={String(s.defaultRate)}
            onValueChange={(v) => s.set("defaultRate", Number(v))}
            options={[0.7, 0.85, 1, 1.15].map((r) => ({
              value: String(r),
              label: `${r}×`,
            }))}
          />
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
          <SelectField
            aria-label="Escalera de texto"
            value={s.showText}
            onValueChange={(v) => s.set("showText", v as typeof s.showText)}
            options={[
              { value: "always", label: "Siempre visible" },
              { value: "fade", label: "Escalera (se atenúa)" },
              { value: "never", label: "Nunca" },
            ]}
          />
        </Field>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Tema">
          <SelectField
            aria-label="Tema"
            value={s.theme}
            onValueChange={(v) => s.set("theme", v as typeof s.theme)}
            options={[
              { value: "system", label: "Del sistema" },
              { value: "light", label: "Claro" },
              { value: "dark", label: "Oscuro" },
            ]}
          />
        </Field>
        <Field label="Tamaño de letra">
          <SelectField
            aria-label="Tamaño de letra"
            value={String(s.fontSize)}
            onValueChange={(v) => s.set("fontSize", Number(v))}
            options={[14, 15, 16, 18, 20].map((px) => ({
              value: String(px),
              label: `${px} px`,
            }))}
          />
        </Field>
        <Field
          label="Auriculares"
          hint="Con auriculares se desactiva la cancelación de eco al grabar."
        >
          <SelectField
            aria-label="Auriculares"
            value={
              s.usesHeadphones === null ? "ask" : s.usesHeadphones ? "yes" : "no"
            }
            onValueChange={(v) =>
              s.set("usesHeadphones", v === "ask" ? null : v === "yes")
            }
            options={[
              { value: "ask", label: "Preguntar" },
              { value: "yes", label: "Sí, siempre" },
              { value: "no", label: "No" },
            ]}
          />
        </Field>
        <Field
          label="Compensación de latencia del micro (ms)"
          hint="Vacío = automático según el dispositivo."
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
