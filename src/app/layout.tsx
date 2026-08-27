import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/AppFrame";

export const metadata: Metadata = {
  title: "Shadowing",
  description:
    "Práctica personal de shadowing, entonación y pronunciación. 100% local y offline.",
  applicationName: "Shadowing",
  appleWebApp: { capable: true, title: "Shadowing", statusBarStyle: "default" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#fdfaf5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Aplica tema y tamaño de letra antes del primer pintado para evitar parpadeo.
const bootstrap = `(function(){try{
  var s = JSON.parse(localStorage.getItem('shadowing.settings')||'{}');
  if (s.theme === 'dark' || s.theme === 'light') document.documentElement.dataset.theme = s.theme;
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  if (s.fontSize) document.documentElement.style.setProperty('--app-font-size', s.fontSize + 'px');
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
      </head>
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
