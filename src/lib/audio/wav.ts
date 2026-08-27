/**
 * Empaquetado de PCM crudo en WAV. Gemini devuelve L16 PCM sin cabecera,
 * que ningún <audio> sabe reproducir tal cual.
 */
export function pcm16ToWav(
  pcm: ArrayBuffer,
  sampleRate: number,
  channels = 1,
): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const out = new ArrayBuffer(44 + pcm.byteLength);
  const dv = new DataView(out);

  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  dv.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true); // tamaño del bloque fmt
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, "data");
  dv.setUint32(40, pcm.byteLength, true);

  new Uint8Array(out, 44).set(new Uint8Array(pcm));
  return out;
}

/** Extrae la frecuencia de muestreo de un mime tipo `audio/L16;rate=24000`. */
export function sampleRateFromMime(mime: string, fallback = 24000): number {
  const m = /rate=(\d+)/i.exec(mime);
  return m ? Number(m[1]) : fallback;
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
