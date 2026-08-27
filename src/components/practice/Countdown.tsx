"use client";

import * as React from "react";

/** Cuenta atrás 3 · 2 · 1 antes de grabar (§7.A). Tarjeta oscura en el flujo. */
export function Countdown({
  from = 3,
  label = "Sigue la línea del modelo",
  onDone,
}: {
  from?: number;
  label?: string;
  onDone: () => void;
}) {
  const [n, setN] = React.useState(from);

  React.useEffect(() => {
    if (n <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setN((v) => v - 1), 750);
    return () => clearTimeout(t);
  }, [n, onDone]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-card bg-ink py-12 text-white"
      role="alertdialog"
      aria-label={`${label}. ${n > 0 ? n : "ya"}`}
    >
      <p className="h-display text-7xl">{n > 0 ? n : "¡Ya!"}</p>
      <p className="text-sm font-semibold text-white/70">{label}</p>
    </div>
  );
}
