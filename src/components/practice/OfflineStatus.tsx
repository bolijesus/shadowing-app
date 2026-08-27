"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Round } from "@/lib/types";
import { Pill } from "@/components/ui/primitives";
import { fmtBytes } from "@/lib/util";

/**
 * Estado de descarga de una práctica de voz IA. El audio generado vive en
 * OPFS con clave sha256(proveedor+voz+estilo+velocidad+texto): mientras no
 * cambie nada de eso, no se vuelve a llamar a la API ni hace falta red.
 */
export function OfflineStatus({ rounds }: { rounds: Round[] }) {
  const refs = rounds
    .map((r) => r.modelAudioRef)
    .filter((p): p is string => !!p);

  const blobs = useLiveQuery(
    () => (refs.length ? db().blobs.where("path").anyOf(refs).toArray() : []),
    [refs.join(",")],
  );

  const bytes = (blobs ?? []).reduce((s, b) => s + b.bytes, 0);
  const ready = refs.length;
  const total = rounds.length;
  const complete = total > 0 && ready === total;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Pill tone={complete ? "ok" : "neutral"}>
        {complete ? "Descargada" : `${ready} de ${total} descargadas`}
      </Pill>
      {bytes > 0 && (
        <span className="text-ink-soft">{fmtBytes(bytes)} en el dispositivo</span>
      )}
      <span className="text-ink-soft">
        {complete
          ? "· Se practica sin conexión y sin volver a llamar a la API."
          : "· Las voces preparadas ya no vuelven a pedirse a la API."}
      </span>
    </div>
  );
}
