// Copia el motor de IPA a /public para poder cargarlo en tiempo de ejecución.
// El módulo de Emscripten localiza su .wasm con `new URL('./', import.meta.url)`,
// que webpack no sabe resolver, así que no se puede empaquetar.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
try {
  const dist = dirname(require.resolve("espeak-ng/dist/espeak-ng.js"));
  mkdirSync("public/espeak", { recursive: true });
  for (const f of ["espeak-ng.js", "espeak-ng.wasm"]) {
    const from = join(dist, f);
    if (existsSync(from)) copyFileSync(from, join("public/espeak", f));
  }
  console.log("espeak-ng copiado a public/espeak");
} catch (e) {
  console.warn("No se pudo copiar espeak-ng:", e.message);
  console.warn("El IPA multilingüe no funcionará; el inglés sí (cmudict).");
}
