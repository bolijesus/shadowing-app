"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Round } from "@/lib/types";
import { Button, Card, Eyebrow, Select } from "@/components/ui/primitives";
import { fmtClock } from "@/lib/util";
import type { ShowText } from "@/lib/types";

export default function EditPracticePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const practice = useLiveQuery(() => db().practices.get(id), [id]);
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

  const [order, setOrder] = React.useState<string[]>([]);
  const [texts, setTexts] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (practice && rounds) {
      setOrder(practice.roundIds);
      setTexts(Object.fromEntries(rounds.map((r) => [r.id, r.text])));
    }
  }, [practice?.id, rounds?.length]);

  if (!practice) {
    return (
      <p className="p-8 text-center text-ink-soft">Esta práctica ya no existe.</p>
    );
  }

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    setDirty(true);
  };
  const remove = (rid: string) => {
    setOrder((o) => o.filter((x) => x !== rid));
    setDirty(true);
  };

  const save = async () => {
    await db().transaction("rw", db().practices, db().rounds, async () => {
      await db().practices.update(id, { roundIds: order });
      await Promise.all(
        order.map((rid, index) =>
          db().rounds.update(rid, { index, text: texts[rid] ?? "" }),
        ),
      );
    });
    setDirty(false);
    router.push(`/practica/${id}`);
  };

  const byId = new Map((rounds ?? []).map((r) => [r.id, r]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow>Editor</Eyebrow>
          <h1 className="h-display mt-1 text-2xl">{practice.title}</h1>
        </div>
        <Link href={`/practica/${id}`}>
          <Button variant="ghost">Probar como estudiante →</Button>
        </Link>
      </div>

      <Card className="flex items-center gap-3">
        <label className="text-sm font-semibold">Mostrar el texto</label>
        <Select
          value={practice.showText}
          onChange={(e) =>
            db().practices.update(id, {
              showText: e.target.value as ShowText,
            })
          }
          className="max-w-[220px]"
        >
          <option value="always">Siempre</option>
          <option value="fade">Escalera</option>
          <option value="never">Nunca</option>
        </Select>
      </Card>

      <ol className="space-y-2">
        {order.map((rid, i) => {
          const r = byId.get(rid);
          if (!r) return null;
          return (
            <li
              key={rid}
              className="rounded-card border border-line bg-surface p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs text-ink-soft">
                  Ronda {i + 1} · {fmtClock(r.startSec)}–{fmtClock(r.endSec)}
                </span>
                <div className="flex gap-1">
                  <IconBtn label="Subir" onClick={() => move(i, -1)}>
                    ↑
                  </IconBtn>
                  <IconBtn label="Bajar" onClick={() => move(i, 1)}>
                    ↓
                  </IconBtn>
                  <IconBtn label="Quitar" onClick={() => remove(rid)}>
                    ✕
                  </IconBtn>
                </div>
              </div>
              <textarea
                value={texts[rid] ?? ""}
                onChange={(e) => {
                  setTexts((t) => ({ ...t, [rid]: e.target.value }));
                  setDirty(true);
                }}
                rows={2}
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-20 flex gap-2 sm:bottom-4">
        <Button variant="primary" onClick={save} disabled={!dirty}>
          Guardar cambios
        </Button>
        <Link href={`/practica/${id}`}>
          <Button variant="secondary">Descartar</Button>
        </Link>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="h-9 w-9 rounded border border-line text-ink-soft hover:bg-panel"
    >
      {children}
    </button>
  );
}
