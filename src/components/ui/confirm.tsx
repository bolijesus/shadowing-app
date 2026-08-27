"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirmación sobre el Dialog de shadcn/ui.
 * Nunca se usa alert()/confirm() del navegador (§16).
 */
export function useConfirm() {
  const [state, setState] = React.useState<{
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    tone: "default" | "danger";
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback(
    (opts: {
      title: string;
      body: React.ReactNode;
      confirmLabel?: string;
      tone?: "default" | "danger";
    }) =>
      new Promise<boolean>((resolve) =>
        setState({
          title: opts.title,
          body: opts.body,
          confirmLabel: opts.confirmLabel ?? "Confirmar",
          tone: opts.tone ?? "default",
          resolve,
        }),
      ),
    [],
  );

  const settle = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  const node = (
    <Dialog open={!!state} onOpenChange={(o) => !o && settle(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="h-display text-lg">{state?.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[15px] text-ink-soft">{state?.body}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            Cancelar
          </Button>
          <Button
            variant={state?.tone === "danger" ? "record" : "default"}
            onClick={() => settle(true)}
          >
            {state?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, node };
}
