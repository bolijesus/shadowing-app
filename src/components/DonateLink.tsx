import { cx } from "@/components/ui/primitives";

/**
 * Enlace de donación a Ko-fi.
 *
 * Es un ancla normal, no el widget de Ko-fi. El widget carga un script de
 * terceros que vería cada visita y cada página: eso rompería la promesa de la
 * app —nada sale del dispositivo, todo funciona sin conexión— y además el
 * script no estaría en la caché del service worker, así que sin red daría
 * error. Un enlace no pide nada hasta que lo pulsas.
 */
export const KOFI_URL = "https://ko-fi.com/elboli";

export function DonateLink({
  variant = "full",
  className,
}: {
  /** `icon` para barras apretadas, como la cabecera de la práctica. */
  variant?: "full" | "icon";
  className?: string;
}) {
  const label = "Invítame a un café";
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      // `noopener` impide que la pestaña abierta toque a esta por
      // `window.opener`; `noreferrer` evita mandar de dónde vienes.
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-line-strong font-bold text-ink transition-colors hover:border-brand hover:text-brand-ink",
        variant === "icon" ? "px-2 py-1.5 text-sm" : "px-3 py-2 text-sm",
        className,
      )}
    >
      <span aria-hidden="true">☕</span>
      {variant === "full" && <span>Apoyar</span>}
    </a>
  );
}
