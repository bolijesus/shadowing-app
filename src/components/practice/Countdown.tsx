"use client";

import * as React from "react";

/** Cuenta atrás 3 · 2 · 1 antes de grabar (§7.A). */
export function Countdown({
  from = 3,
  label = "Prepárate",
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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg/90"
      role="alertdialog"
      aria-label={`${label}. ${n}`}
    >
      <p className="eyebrow">{label}</p>
      <p className="h-display text-8xl text-accent">{n > 0 ? n : "¡Ya!"}</p>
    </div>
  );
}
