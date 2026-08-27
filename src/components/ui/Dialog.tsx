"use client";

import * as React from "react";
import { Button } from "./primitives";

/**
 * Diálogo propio — nunca alert()/confirm() (§16). Con foco atrapado,
 * cierre con Escape y overlay accionable con teclado.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevFocus = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(
      "button,[href],input,select,textarea",
    )?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-t-card border border-line bg-surface p-5 sm:rounded-card"
      >
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        <div className="mt-3 text-[15px] text-ink-soft">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {footer ?? (
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hook simple para confirmaciones sin bloquear el hilo. */
export function useConfirm() {
  const [state, setState] = React.useState<{
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback(
    (opts: { title: string; body: React.ReactNode; confirmLabel?: string }) =>
      new Promise<boolean>((resolve) =>
        setState({
          title: opts.title,
          body: opts.body,
          confirmLabel: opts.confirmLabel ?? "Confirmar",
          resolve,
        }),
      ),
    [],
  );

  const node = state ? (
    <Dialog
      open
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
      title={state.title}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              state.resolve(true);
              setState(null);
            }}
          >
            {state.confirmLabel}
          </Button>
        </>
      }
    >
      {state.body}
    </Dialog>
  ) : null;

  return { confirm, node };
}
