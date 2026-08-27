import { NextResponse } from "next/server";

/**
 * Proxy opcional del `timedtext` público de YouTube (§4.2).
 * Los subtítulos no son accesibles por CORS desde el navegador, así que
 * esta ruta hace de puente. Si el despliegue es estático y la ruta no
 * existe, el cliente degrada solo: nunca revienta.
 *
 * No descarga audio ni vídeo: solo la pista de texto pública.
 */

export const runtime = "edge";

interface Track {
  lang: string;
  name: string;
  kind: string;
}

function xmlText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const videoId = url.searchParams.get("videoId");
  const lang = url.searchParams.get("lang");

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: "Falta un videoId válido." },
      { status: 400 },
    );
  }

  try {
    // Sin lang: se listan las pistas disponibles.
    if (!lang) {
      const res = await fetch(
        `https://video.google.com/timedtext?type=list&v=${videoId}`,
        { headers: { "User-Agent": "Mozilla/5.0" } },
      );
      if (!res.ok) {
        return NextResponse.json({ tracks: [] as Track[] }, { status: 200 });
      }
      const xml = await res.text();
      const tracks: Track[] = [];
      for (const m of xml.matchAll(/<track\b[^>]*>/g)) {
        const tag = m[0];
        const attr = (n: string) =>
          new RegExp(`${n}="([^"]*)"`).exec(tag)?.[1] ?? "";
        const code = attr("lang_code");
        if (code) {
          tracks.push({
            lang: code,
            name: attr("name") || attr("lang_original") || code,
            kind: attr("kind") || "manual",
          });
        }
      }
      return NextResponse.json(
        { tracks },
        { headers: { "Cache-Control": "public, max-age=86400" } },
      );
    }

    // Con lang: se devuelve la pista como cues.
    const res = await fetch(
      `https://video.google.com/timedtext?lang=${encodeURIComponent(lang)}&v=${videoId}`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) {
      return NextResponse.json({ cues: [] }, { status: 200 });
    }
    const xml = await res.text();
    const cues: { start: number; end: number; text: string }[] = [];
    for (const m of xml.matchAll(
      /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g,
    )) {
      const start = Number(m[1]);
      const dur = Number(m[2] ?? "2");
      const text = xmlText(m[3] ?? "");
      if (text) cues.push({ start, end: start + dur, text });
    }
    return NextResponse.json(
      { cues },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    // Degradación limpia: el cliente ofrecerá subir un .srt.
    return NextResponse.json({ tracks: [], cues: [] }, { status: 200 });
  }
}
