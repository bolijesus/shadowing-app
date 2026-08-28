/**
 * Copia a /public los binarios que hay que servir en tiempo de ejecución.
 *
 * - espeak-ng: su módulo de Emscripten localiza el .wasm con
 *   `new URL('./', import.meta.url)`, que webpack no resuelve.
 * - onnxruntime-web: si no se auto-hospeda, lo busca en un CDN. Sin red —o
 *   con el CDN bloqueado— falla con "no available backend found", y entonces
 *   ni WebGPU ni WASM arrancan. La app debe funcionar sin conexión (§1.6).
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
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

function copyOnnx() {
  // No se puede resolver por require: transformers.js lo trae como
  // dependencia anidada. Se busca en el almacén de pnpm.
  const roots = ["node_modules/onnxruntime-web/dist"];
  const store = "node_modules/.pnpm";
  if (existsSync(store)) {
    for (const d of readdirSync(store)) {
      if (d.startsWith("onnxruntime-web@")) {
        roots.push(join(store, d, "node_modules/onnxruntime-web/dist"));
      }
    }
  }
  const dist = roots.find((r) => existsSync(r));
  if (!dist) {
    console.warn("onnxruntime-web no encontrado: Whisper local no funcionará.");
    return;
  }

  mkdirSync("public/ort", { recursive: true });
  let n = 0;
  for (const f of readdirSync(dist)) {
    // Los .wasm y sus cargadores .mjs; el resto lo empaqueta webpack.
    if (f.endsWith(".wasm") || /^ort-wasm.*\.mjs$/.test(f)) {
      copyFileSync(join(dist, f), join("public/ort", f));
      n++;
    }
  }
  console.log(`onnxruntime-web -> public/ort (${n} archivos)`);
}

copyEspeak();
copyOnnx();
