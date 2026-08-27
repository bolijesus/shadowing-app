"use client";

import * as React from "react";
import {
  getStorageBreakdown,
  type StorageBreakdown,
} from "@/lib/storage/accounting";
import {
  CATEGORY_LABEL,
} from "@/lib/storage/accounting";
import { Button, Card, Eyebrow, TextInput } from "@/components/ui/primitives";
import { Dialog, useConfirm } from "@/components/ui/Dialog";
import { deleteBlob } from "@/lib/storage/blobStore";
import {
  deleteRecordingsOlderThan,
  deleteUnsavedTakes,
} from "@/lib/db/repositories";
import { wipeAllData } from "@/lib/storage/wipe";
import { ensurePersistentStorage } from "@/lib/storage/persist";
import { fmtBytes, fmtDate } from "@/lib/util";

export default function StoragePage() {
  const [data, setData] = React.useState<StorageBreakdown | null>(null);
  const [sort, setSort] = React.useState<"date" | "size">("date");
  const [persistent, setPersistent] = React.useState<boolean | null>(null);
  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [wipeWord, setWipeWord] = React.useState("");
  const [wipeKeys, setWipeKeys] = React.useState(false);
  const [wipeStep, setWipeStep] = React.useState<string | null>(null);
  const { confirm, node } = useConfirm();

  const refresh = React.useCallback(async () => {
    setData(await getStorageBreakdown());
    if (navigator.storage?.persisted)
      setPersistent(await navigator.storage.persisted());
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const items = React.useMemo(() => {
    const list = [...(data?.items ?? [])];
    list.sort((a, b) =>
      sort === "size" ? b.bytes - a.bytes : b.createdAt - a.createdAt,
    );
    return list;
  }, [data, sort]);

  const pct =
    data && data.quota > 0 ? Math.min(100, (data.usage / data.quota) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Almacenamiento</Eyebrow>
        <h1 className="h-display mt-1 text-2xl">Qué ocupa espacio</h1>
      </div>

      <Card className="space-y-3">
        <div className="flex items-end justify-between">
          <span className="text-sm text-ink-soft">Usado del navegador</span>
          <span className="font-display text-xl font-bold">
            {data ? fmtBytes(data.usage) : "…"}
            {data && data.quota > 0 && (
              <span className="ml-1 text-sm font-medium text-ink-soft">
                / {fmtBytes(data.quota)}
              </span>
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-panel">
          <div className="h-full bg-data" style={{ width: `${pct}%` }} />
        </div>
        {data && data.overhead > 0 && (
          <p className="text-xs text-ink-soft">
            De ese total, {fmtBytes(data.ledgerTotal)} son archivos de la app y{" "}
            {fmtBytes(data.overhead)} son caché del navegador y metadatos.
          </p>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span
            className={
              persistent
                ? "rounded-full bg-ok/15 px-2 py-1 font-semibold text-ok"
                : "rounded-full bg-panel px-2 py-1 font-semibold text-ink-soft"
            }
          >
            {persistent
              ? "Almacenamiento persistente activado"
              : "Almacenamiento no persistente"}
          </span>
          {!persistent && (
            <Button
              variant="ghost"
              onClick={async () => {
                await ensurePersistentStorage();
                void refresh();
              }}
            >
              Activar
            </Button>
          )}
        </div>
      </Card>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Por categoría</h2>
        {(data?.byCategory ?? []).map((c) => (
          <div
            key={c.category}
            className="flex items-center justify-between rounded-control border border-line bg-surface px-4 py-2.5 text-sm"
          >
            <span className="font-semibold text-ink">
              {CATEGORY_LABEL[c.category]}
            </span>
            <span className="text-ink-soft">
              {c.count} · {fmtBytes(c.bytes)}
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Por elemento</h2>
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => setSort("date")}
              className={sort === "date" ? "font-bold text-ink" : "text-ink-soft"}
            >
              Fecha
            </button>
            <span className="text-line">·</span>
            <button
              onClick={() => setSort("size")}
              className={sort === "size" ? "font-bold text-ink" : "text-ink-soft"}
            >
              Tamaño
            </button>
          </div>
        </div>
        <div className="divide-y divide-line rounded-card border border-line bg-surface">
          {items.length === 0 && (
            <p className="p-4 text-sm text-ink-soft">Nada guardado todavía.</p>
          )}
          {items.map((it) => (
            <div
              key={it.path}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono text-xs text-ink-soft">
                  {it.path}
                </span>
              </span>
              <span className="shrink-0 text-ink-soft">
                {fmtBytes(it.bytes)} · {fmtDate(it.createdAt)}
              </span>
              <button
                aria-label={`Borrar ${it.path}`}
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Borrar archivo",
                      body: it.path,
                      confirmLabel: "Borrar",
                    })
                  ) {
                    await deleteBlob(it.path);
                    void refresh();
                  }
                }}
                className="shrink-0 text-xs font-semibold text-ink-soft hover:text-accent"
              >
                Borrar
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Limpieza</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const n = await deleteRecordingsOlderThan(30);
              await refresh();
              await confirm({
                title: "Hecho",
                body: `${n} grabaciones de más de 30 días borradas.`,
                confirmLabel: "Vale",
              });
            }}
          >
            Borrar grabaciones de +30 días
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const n = await deleteUnsavedTakes();
              await refresh();
              await confirm({
                title: "Hecho",
                body: `${n} tomas no guardadas borradas.`,
                confirmLabel: "Vale",
              });
            }}
          >
            Borrar solo tomas no guardadas
          </Button>
        </div>
        <Button
          variant="record"
          full
          onClick={() => {
            setWipeWord("");
            setWipeOpen(true);
          }}
        >
          Borrar todos los datos
        </Button>
      </section>

      <Dialog
        open={wipeOpen}
        onClose={() => !wipeStep && setWipeOpen(false)}
        title="Borrar todos los datos"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={!!wipeStep}
              onClick={() => setWipeOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="record"
              disabled={wipeWord !== "BORRAR" || !!wipeStep}
              onClick={() =>
                wipeAllData({
                  wipeApiKeys: wipeKeys,
                  onProgress: (s) => setWipeStep(s),
                })
              }
            >
              {wipeStep ?? "Borrar definitivamente"}
            </Button>
          </>
        }
      >
        <p>
          Se borrarán medios importados, voces, grabaciones, recortes, análisis,
          modelos, transcripciones, cachés y preferencias. Los archivos que
          referencias por ruta no se tocan.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={wipeKeys}
            onChange={(e) => setWipeKeys(e.target.checked)}
          />
          Borrar también las API keys guardadas
        </label>
        <p className="mt-3 text-sm">
          Escribe <strong>BORRAR</strong> para confirmar:
        </p>
        <TextInput
          value={wipeWord}
          onChange={(e) => setWipeWord(e.target.value)}
          className="mt-1"
        />
      </Dialog>

      {node}
    </div>
  );
}
