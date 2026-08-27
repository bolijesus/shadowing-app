"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import { Button, Card, Eyebrow, EmptyState } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/util";

export default function HomePage() {
  const practices = useLiveQuery(
    () => db().practices.orderBy("createdAt").reverse().limit(8).toArray(),
    [],
  );
  const takeCount = useLiveQuery(() => db().takes.count(), []);

  return (
    <div className="space-y-6">
      <section>
        <Eyebrow>Práctica · Confianza en el trabajo</Eyebrow>
        <h1 className="h-display mt-1 text-3xl sm:text-4xl">
          Escucha, imita, repite.
        </h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Todo se guarda en este dispositivo. Sin cuentas, sin nube, funciona sin
          conexión.
        </p>
      </section>

      <Link href="/nueva" className="block">
        <Button variant="default" className="w-full h-16 text-lg">
          Nueva práctica
        </Button>
      </Link>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <Eyebrow>Repaso de hoy</Eyebrow>
          <p className="mt-1 text-2xl font-bold text-ink">Sin frases pendientes</p>
          <p className="mt-1 text-sm text-ink-soft">
            El mazo de repaso espaciado llega en una fase posterior.
          </p>
        </Card>
        <Card>
          <Eyebrow>Actividad</Eyebrow>
          <p className="mt-1 text-2xl font-bold text-data">
            {takeCount ?? 0}
            <span className="ml-1 text-base font-medium text-ink-soft">
              tomas grabadas
            </span>
          </p>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold">Prácticas recientes</h2>
        {practices && practices.length > 0 ? (
          <ul className="space-y-2">
            {practices.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/practica/${p.id}`}
                  className="flex items-center justify-between rounded-xl border-2 border-line bg-surface px-4 py-3 hover:bg-panel"
                >
                  <span>
                    <span className="font-semibold text-ink">{p.title}</span>
                    <span className="ml-2 text-xs text-ink-soft">
                      {p.roundIds.length} rondas · {fmtDate(p.createdAt)}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-ink-soft">Abrir →</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Aún no hay prácticas">
            Crea la primera con un archivo de audio o vídeo del dispositivo y sus
            subtítulos.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
