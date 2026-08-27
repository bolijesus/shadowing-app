"use client";

import * as React from "react";
import { Field, SelectField } from "@/components/ui/primitives";
import { ttsProvider, ttsProviders } from "@/lib/tts/providers";
import { DELIVERY_STYLES, type TtsProviderId, type TtsVoice } from "@/lib/tts/types";
import { getKeystore } from "@/lib/crypto/keystore";

export interface VoiceSelection {
  provider: TtsProviderId;
  voice: string;
  style: string;
  rate: number;
}

/** Selector de voz + entrega, como en las capturas del editor. */
export function VoicePicker({
  value,
  onChange,
  language,
  compact,
}: {
  value: VoiceSelection;
  onChange: (v: VoiceSelection) => void;
  language: string;
  compact?: boolean;
}) {
  const [voices, setVoices] = React.useState<TtsVoice[]>([]);

  // El desplegable enseñaba la primera voz sin escribirla en el estado, así
  // que se enviaba una voz vacía. Al cargar la lista se fija una válida.
  const latest = React.useRef({ value, onChange });
  latest.current = { value, onChange };

  const applyVoices = React.useCallback((list: TtsVoice[]) => {
    setVoices(list);
    if (!list.length) return;
    const { value: v, onChange: cb } = latest.current;
    if (!v.voice || !list.some((x) => x.id === v.voice)) {
      cb({ ...v, voice: list[0]!.id });
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await ttsProvider(value.provider).voices(language);
      if (!cancelled) applyVoices(list);
    })();
    // speechSynthesis puebla las voces de forma asíncrona.
    const t = setTimeout(async () => {
      const list = await ttsProvider(value.provider).voices(language);
      if (!cancelled) applyVoices(list);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value.provider, language, applyVoices]);

  const ks = getKeystore();
  const providerOptions = ttsProviders().map((p) => {
    const hasKey = !p.needsApiKey || !!ks?.providers[p.id]?.apiKey || !!ks?.providers[p.id]?.proxyUrl;
    return {
      value: p.id,
      label: p.label + (p.needsApiKey && !hasKey ? " · sin key" : ""),
    };
  });

  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-3"}>
      {!compact && (
        <Field label="Proveedor">
          <SelectField
            aria-label="Proveedor de voz"
            value={value.provider}
            onValueChange={(v) =>
              onChange({ ...value, provider: v as TtsProviderId, voice: "" })
            }
            options={providerOptions}
          />
        </Field>
      )}

      <Field label={value.provider === "elevenlabs" ? "ID de voz" : "Voz"}>
        {voices.length ? (
          <SelectField
            aria-label="Voz"
            value={value.voice || voices[0]!.id}
            onValueChange={(v) => onChange({ ...value, voice: v })}
            options={voices.map((v) => ({ value: v.id, label: v.label }))}
          />
        ) : (
          <input
            aria-label="Voz"
            value={value.voice}
            onChange={(e) => onChange({ ...value, voice: e.target.value })}
            placeholder={
              value.provider === "elevenlabs"
                ? "voice_id de ElevenLabs"
                : "Automática"
            }
            className="h-12 w-full rounded-lg border-2 border-input bg-surface px-3 font-medium text-ink outline-none focus-visible:border-ring"
          />
        )}
      </Field>

      <Field label="Entrega">
        <SelectField
          aria-label="Entrega"
          value={value.style}
          onValueChange={(v) => onChange({ ...value, style: v })}
          options={DELIVERY_STYLES.map((s) => ({ value: s.id, label: s.label }))}
        />
      </Field>
    </div>
  );
}

export const DEFAULT_VOICE: VoiceSelection = {
  provider: "browser",
  voice: "",
  style: "clear",
  rate: 1,
};
