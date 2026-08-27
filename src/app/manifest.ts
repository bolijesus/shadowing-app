import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shadowing — práctica de pronunciación",
    short_name: "Shadowing",
    description:
      "Práctica personal de shadowing, entonación y pronunciación. 100% local y offline.",
    start_url: "/",
    display: "standalone",
    background_color: "#fdfaf5",
    theme_color: "#fdfaf5",
    lang: "es",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
