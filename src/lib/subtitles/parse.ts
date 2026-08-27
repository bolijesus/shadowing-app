import type { Cue } from "@/lib/types";

/** Parser propio de SRT / VTT / ASS básico → Cue[] (prompt §4.1). */

function toSec(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000
  );
}

const TIME_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
const TIME_RE_SHORT = /(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\r/g, "")
    .trim();
}

export function parseSrtVtt(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const blocks = text.split(/\n\s*\n/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;

    let timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx]!;
    let m = TIME_RE.exec(timeLine);
    let start: number;
    let end: number;
    if (m) {
      start = toSec(m[1]!, m[2]!, m[3]!, m[4]!);
      end = toSec(m[5]!, m[6]!, m[7]!, m[8]!);
    } else {
      const ms = TIME_RE_SHORT.exec(timeLine);
      if (!ms) continue;
      start = toSec("0", ms[1]!, ms[2]!, ms[3]!);
      end = toSec("0", ms[4]!, ms[5]!, ms[6]!);
    }

    const body = stripTags(lines.slice(timeLineIdx + 1).join(" "));
    if (body && end > start) cues.push({ start, end, text: body });
  }
  return cues;
}

/** ASS/SSA básico: solo líneas Dialogue del bloque [Events]. */
export function parseAss(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const fmtLine = lines.find((l) => l.trim().toLowerCase().startsWith("format:") && l.includes("Start"));
  const fields = (fmtLine?.split(":")[1] ?? "Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text")
    .split(",")
    .map((s) => s.trim());
  const iStart = fields.indexOf("Start");
  const iEnd = fields.indexOf("End");
  const iText = fields.indexOf("Text");
  const iName = fields.indexOf("Name");

  const assTime = (t: string): number => {
    const mm = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(t.trim());
    return mm ? toSec(mm[1]!, mm[2]!, mm[3]!, mm[4]!) : NaN;
  };

  const cues: Cue[] = [];
  for (const l of lines) {
    if (!l.trim().toLowerCase().startsWith("dialogue:")) continue;
    const rest = l.slice(l.indexOf(":") + 1);
    const parts = rest.split(",");
    const start = assTime(parts[iStart] ?? "");
    const end = assTime(parts[iEnd] ?? "");
    const body = stripTags(parts.slice(iText).join(",").replace(/\\N/g, " "));
    const speaker = iName >= 0 ? parts[iName]?.trim() || undefined : undefined;
    if (isFinite(start) && isFinite(end) && end > start && body) {
      cues.push({ start, end, text: body, speaker });
    }
  }
  return cues;
}

export function parseSubtitles(fileName: string, raw: string): Cue[] {
  const ext = fileName.toLowerCase().split(".").pop();
  const cues =
    ext === "ass" || ext === "ssa" || /^\[Script Info\]/m.test(raw)
      ? parseAss(raw)
      : parseSrtVtt(raw);
  return cues.sort((a, b) => a.start - b.start);
}
