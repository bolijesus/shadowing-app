/**
 * Copia a /public los binarios que hay que servir en tiempo de ejecución.
 *
 * espeak-ng, el motor de IPA: su módulo de Emscripten localiza el .wasm con
 * `new URL('./', import.meta.url)`, que webpack no sabe resolver, así que no
 * se puede empaquetar y hay que servirlo aparte.
 */
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function copyEspeak() {
  try {
    const dist = dirname(require.resolve("espeak-ng/dist/espeak-ng.js"));
    mkdirSync("public/espeak", { recursive: true });
    for (const f of ["espeak-ng.js", "espeak-ng.wasm"]) {
      const from = join(dist, f);
      if (existsSync(from)) copyFileSync(from, join("public/espeak", f));
    }
    console.log("espeak-ng -> public/espeak");
  } catch (e) {
    console.warn("espeak-ng no copiado:", e.message);
    console.warn("  El IPA multilingüe no funcionará; el inglés sí (cmudict).");
  }
}

copyEspeak();
