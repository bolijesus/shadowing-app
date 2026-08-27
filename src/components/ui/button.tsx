import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Botón de shadcn/ui reestilizado según §12:
 * - primario (`default`): negro sólido, texto blanco bold
 * - secundario (`outline`): contorno sobre blanco
 * - grabar (`record`): contorno rojo sobre rojo muy claro
 * Alturas ≥ 48px en los tamaños de transporte (§12, móvil).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-transparent bg-clip-padding font-bold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border-primary hover:opacity-85",
        outline:
          "border-line-strong bg-surface text-ink hover:border-foreground hover:bg-panel",
        secondary:
          "bg-panel text-ink border-panel hover:border-line-strong",
        ghost:
          "text-ink-soft font-semibold hover:bg-panel hover:text-ink",
        record:
          "border-brand bg-brand-tint text-brand-ink hover:bg-brand hover:text-white",
        destructive:
          "border-brand bg-brand-tint text-brand-ink hover:bg-brand hover:text-white",
        link: "text-brand-ink underline underline-offset-4 border-transparent hover:text-ink",
      },
      size: {
        default: "h-12 px-5 text-[15px]",
        sm: "h-9 px-3 text-sm rounded-md",
        xs: "h-8 px-2.5 text-xs rounded-md",
        lg: "h-14 px-6 text-base",
        xl: "h-16 px-6 text-lg",
        icon: "size-12",
        "icon-sm": "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
