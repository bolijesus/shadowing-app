"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Round, Take } from "@/lib/types";
import { Button, Card, Eyebrow, EmptyState } from "@/components/ui/primitives";
import { readAsObjectURL } from "@/lib/storage/opfs";
import { fmtClock } from "@/lib/util";

export default function ResultsPage() {
  const { practiceId } = useParams<{ practiceId: string }>();

  const practice = useLiveQuery(
    () => db().practices.get(practiceId),
    [practiceId],
  );
  const rounds = useLiveQuery<Round[]>(
    () =>
      practice
        ? db()
            .rounds.where("id")
            .anyOf(practice.roundIds)
            .toArray()
            .then((rs) =>
              rs.sort(
                (a, b) =>
                  practice.roundIds.indexOf(a.id) -
                  practice.roundIds.indexOf(b.id),
              ),
            )
        : [],
    [practice?.roundIds.join(",")],
  );
  const takes = useLiveQuery<Take[]>(
    () =>
      rounds && rounds.length
        ? db()
            .takes.where("roundId")
            .anyOf(rounds.map((r) => r.id))
            .toArray()
        : [],
    [rounds?.map((r) => r.id).join(",")],
  );

  const latestByRound = React.useMemo(() => {
    const m = new Map<string, Take>();
    for (const t of takes ?? []) {
      const cur = m.get(t.roundId);
      if (!cur || t.createdAt > cur.createdAt) m.set(t.roundId, t);
    }
    return m;
  }, [takes]);

  if (!practice) {
    return (
      <EmptyState title="Sin resultados">Esta práctica ya no existe.</EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Resumen</Eyebrow>
        <h1 className="h-display mt-1 text-2xl">{practice.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {latestByRound.size} de {rounds?.length ?? 0} rondas con toma guardada.
          La puntuación acústica llega en la fase de análisis.
        </p>
      </div>

      <div className="flex gap-2">
        <Link href={`/practica/${practice.id}`}>
          <Button variant="primary">Repetir práctica</Button>
        </Link>
        <Link href={`/practica/${practice.id}/editar`}>
          <Button variant="secondary">Editar rondas</Button>
        </Link>
      </div>

      <ol className="space-y-3">
        {(rounds ?? []).map((r, i) => (
          <RoundResult
            key={r.id}
            index={i}
            round={r}
            take={latestByRound.get(r.id)}
          />
        ))}
      </ol>
    </div>
  );
}

function RoundResult({
  index,
  round,
  take,
}: {
  index: number;
  round: Round;
  take?: Take;
}) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let revoked: string | null = null;
    if (take?.audioRef) {
      readAsObjectURL(take.audioRef, take.mime)
        .then((u) => {
          revoked = u;
          setUrl(u);
        })
        .catch(() => setUrl(null));
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [take?.audioRef, take?.mime]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono text-ink-soft">
            Ronda {index + 1} · {fmtClock(round.startSec)}–{fmtClock(round.endSec)}
          </p>
          <p className="mt-1 font-semibold text-ink">
            {round.text || <span className="text-ink-soft">(sin texto)</span>}
          </p>
        </div>
        <span
          className={
            take
              ? "shrink-0 rounded-full bg-ok/15 px-2 py-1 text-xs font-semibold text-ok"
              : "shrink-0 rounded-full bg-panel px-2 py-1 text-xs font-semibold text-ink-soft"
          }
        >
          {take ? "Toma guardada" : "Sin toma"}
        </span>
      </div>
      {url && (
        <audio controls src={url} className="mt-3 w-full" preload="none" />
      )}
    </Card>
  );
}
