"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import { Button, Card, Eyebrow, EmptyState, TextInput } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/Dialog";
import {
  deleteClipCascade,
  deleteMediaCascade,
  deletePracticeCascade,
} from "@/lib/db/repositories";
import { fmtBytes, fmtClock, fmtDate } from "@/lib/util";

export default function LibraryPage() {
  const [q, setQ] = React.useState("");
  const { confirm, node } = useConfirm();

  const media = useLiveQuery(() => db().media.toArray(), []);
  const clips = useLiveQuery(() => db().clips.toArray(), []);
  const practices = useLiveQuery(() => db().practices.toArray(), []);
  const blobs = useLiveQuery(() => db().blobs.toArray(), []);

  const bytesByOwner = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const b of blobs ?? [])
      if (b.ownerId) m.set(b.ownerId, (m.get(b.ownerId) ?? 0) + b.bytes);
    return m;
  }, [blobs]);

  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());

  const filteredMedia = (media ?? []).filter((m) => !q || match(m.title));
  const filteredPractices = (practices ?? []).filter((p) => !q || match(p.title));

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Biblioteca</Eyebrow>
        <h1 className="h-display mt-1 text-2xl">Tus medios y prácticas</h1>
      </div>

      <TextInput
        placeholder="Buscar por título…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Prácticas</h2>
        {filteredPractices.length ? (
          filteredPractices
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((p) => (
              <Card key={p.id} className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/practica/${p.id}`}
                    className="font-semibold text-ink hover:underline"
                  >
                    {p.title}
                  </Link>
                  <p className="text-xs text-ink-soft">
                    {p.roundIds.length} rondas · {fmtDate(p.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/practica/${p.id}/editar`}>
                    <Button variant="ghost">Editar</Button>
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Borrar práctica",
                          body: `Se borrarán las tomas de "${p.title}". El medio y el recorte se conservan.`,
                          confirmLabel: "Borrar",
                        })
                      )
                        await deletePracticeCascade(p.id);
                    }}
                  >
                    Borrar
                  </Button>
                </div>
              </Card>
            ))
        ) : (
          <EmptyState title="Sin prácticas">
            <Link href="/nueva" className="font-semibold text-accent">
              Crea la primera →
            </Link>
          </EmptyState>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">Medios y recortes</h2>
        {filteredMedia.length ? (
          filteredMedia
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((m) => {
              const mClips = (clips ?? []).filter((c) => c.mediaId === m.id);
              const own = bytesByOwner.get(m.id) ?? 0;
              return (
                <Card key={m.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-ink">{m.title}</p>
                      <p className="text-xs text-ink-soft">
                        {m.source.kind === "opfs"
                          ? "Importado"
                          : m.source.kind === "local-file"
                            ? m.source.handleId
                              ? "Archivo local (reabrible)"
                              : "Archivo local (solo sesión)"
                            : m.source.kind}
                        {" · "}
                        {fmtClock(m.durationSec)}
                        {own > 0 && ` · ${fmtBytes(own)} en disco`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Borrar medio",
                            body: `Se borrará "${m.title}" con sus ${mClips.length} recortes, rondas, prácticas y tomas.`,
                            confirmLabel: "Borrar todo",
                          })
                        )
                          await deleteMediaCascade(m.id);
                      }}
                    >
                      Borrar
                    </Button>
                  </div>
                  {mClips.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-control bg-panel px-3 py-2 text-sm"
                    >
                      <span>
                        {c.title}{" "}
                        <span className="font-mono text-xs text-ink-soft">
                          {fmtClock(c.startSec)}–{fmtClock(c.endSec)}
                        </span>
                      </span>
                      <button
                        className="text-xs font-semibold text-ink-soft hover:text-accent"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Borrar recorte",
                              body: `Se borrará el recorte "${c.title}" y sus prácticas.`,
                              confirmLabel: "Borrar",
                            })
                          )
                            await deleteClipCascade(c.id);
                        }}
                      >
                        Borrar recorte
                      </button>
                    </div>
                  ))}
                </Card>
              );
            })
        ) : (
          <EmptyState title="Sin medios" />
        )}
      </section>

      {node}
    </div>
  );
}
