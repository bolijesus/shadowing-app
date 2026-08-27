"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Capa fina sobre shadcn/ui con las piezas propias del sistema §12
 * (eyebrow, panel con padding, campo etiquetado, estado vacío).
 * Los componentes base — Button, Card, Input, Select, Dialog… — son de
 * shadcn/ui, reestilizados desde los tokens en globals.css.
 */

export { cn as cx };
export { Button } from "@/components/ui/button";
export { Input as TextInput } from "@/components/ui/input";
export { Label };

/** `PRÁCTICA · CONFIANZA EN EL TRABAJO` — mayúsculas 11px en rojo. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** Tarjeta con padding, la forma más común en la app. */
export function Panel({
  children,
  className,
  ...rest
}: React.ComponentProps<typeof Card>) {
  return (
    <Card className={className} {...rest}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export { Panel as Card };

/** Campo etiquetado: label del sistema + control debajo. */
export function Field({
  label,
  hint,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="font-bold text-ink">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Select de shadcn (Radix) con una API breve de opciones. */
export function SelectField({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn("w-full font-semibold", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-line-strong bg-surface/50 p-8 text-center">
      <p className="h-display text-lg">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
          {children}
        </div>
      )}
    </div>
  );
}

/** Pastilla de estado (`Sin preparar`, `Lista`, `Toma guardada`…). */
export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "brand" | "data";
  className?: string;
}) {
  const tones = {
    neutral: "bg-panel text-ink-soft",
    ok: "bg-ok/15 text-ok",
    brand: "bg-brand-tint text-brand-ink",
    data: "bg-data/10 text-data",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export { Input, Card as RawCard, CardContent };
