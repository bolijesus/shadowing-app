"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { applyFontSize, applyTheme, useSettings } from "@/lib/stores/settings";
import { runStartupGc } from "@/lib/storage/gc";
import { ensurePersistentStorage } from "@/lib/storage/persist";
import { cx } from "@/components/ui/primitives";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/biblioteca", label: "Biblioteca" },
  { href: "/almacenamiento", label: "Almacenamiento" },
  { href: "/configuracion", label: "Ajustes" },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const theme = useSettings((s) => s.theme);
  const fontSize = useSettings((s) => s.fontSize);
  const pathname = usePathname();
  const isPlayer = /^\/practica\/[^/]+$/.test(pathname);

  React.useEffect(() => {
    applyTheme(theme);
    applyFontSize(fontSize);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => theme === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, fontSize]);

  React.useEffect(() => {
    void runStartupGc().catch(() => {});
    const once = () => {
      void ensurePersistentStorage();
      window.removeEventListener("pointerdown", once);
      window.removeEventListener("keydown", once);
    };
    window.addEventListener("pointerdown", once, { once: true });
    window.addEventListener("keydown", once, { once: true });
  }, []);

  if (isPlayer) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-24 pt-4 sm:pb-8">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
          Shadowing
        </Link>
        <nav className="hidden gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "rounded-lg px-3 py-2 text-sm font-semibold",
                pathname === n.href
                  ? "bg-primary text-primary-foreground"
                  : "text-ink-soft hover:bg-panel hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-line bg-surface/95 backdrop-blur sm:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-3 text-xs font-semibold",
              pathname === n.href ? "text-brand-ink" : "text-ink-soft",
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
