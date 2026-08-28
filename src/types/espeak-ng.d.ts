/**
 * espeak-ng@1.0.2 no trae tipos: es el CLI de eSpeak-NG compilado a WASM
 * con Emscripten. Se declara solo lo que usa la app.
 */
declare module "espeak-ng" {
  interface EspeakModule {
    FS: {
      readFile(path: string, opts: { encoding: "utf8" }): string;
    };
  }
  interface EspeakOptions {
    arguments: string[];
  }
  const ESpeakNg: (opts: EspeakOptions) => Promise<EspeakModule>;
  export default ESpeakNg;
}
