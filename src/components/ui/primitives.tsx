"use client";

import * as React from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function Card({
  children,
  className,
  as: As = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As
      className={cx(
        "rounded-card border border-line bg-surface p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

type ButtonVariant = "primary" | "secondary" | "record" | "ghost";

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    full?: boolean;
  }
>(function Button(
  { variant = "secondary", full, className, children, ...rest },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[48px] px-5 text-[15px]";
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-ink text-white hover:opacity-90",
    secondary: "border border-line bg-surface text-ink hover:bg-panel",
    record:
      "border-2 border-accent bg-accent-tint text-accent hover:bg-accent hover:text-white",
    ghost: "text-ink-soft hover:text-ink hover:bg-panel",
  };
  return (
    <button
      ref={ref}
      className={cx(base, styles[variant], full && "w-full", className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink outline-none focus:border-ink",
        props.className,
      )}
    />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select
      {...props}
      className={cx(
        "w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[15px] text-ink outline-none focus:border-ink",
        props.className,
      )}
    />
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
    <div className="rounded-card border border-dashed border-line bg-surface/50 p-8 text-center">
      <p className="font-display text-lg font-bold text-ink">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
          {children}
        </div>
      )}
    </div>
  );
}
