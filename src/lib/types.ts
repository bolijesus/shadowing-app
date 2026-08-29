/**
 * Modelo de datos del dominio (prompt §3) + añadidos internos.
 * Todo vive en el dispositivo: metadatos en IndexedDB (Dexie), blobs en OPFS.
 */

export type PracticeMode = "shadowing-echo" | "curve-duel";

export interface TtsRequest {
  provider: "browser" | "gemini" | "openai" | "elevenlabs";
  voice: string;
  /** Instrucción de estilo en lenguaje natural, ej. "Claro · Cómodo". */
  style: string;
  rate: number;
  text: string;
  language: string;
}

export type Source =
  | {
      kind: "local-file";
      /** Presente en navegadores con File System Access API. */
      handleId?: string;
      fileName: string;
      mime: string;
      sizeBytes: number;
    }
  | { kind: "opfs"; path: string; mime: string; sizeBytes: number }
  | { kind: "youtube"; videoId: string; url: string }
  | { kind: "tts"; generatedFrom: TtsRequest };

export interface MediaItem {
  id: string;
  title: string;
  /** BCP-47, ej. 'en-US'. */
  language: string;
  source: Source;
  durationSec: number;
  hasVideo: boolean;
  createdAt: number;
  /** Picos de onda precalculados en OPFS. */
  peaksRef?: string;
  transcriptId?: string;
}

export type TranscriptOrigin =
  | "file"
  | "youtube-captions"
  | "manual";

export interface Cue {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface Transcript {
  id: string;
  mediaId: string;
  origin: TranscriptOrigin;
  cues: Cue[];
}

/** Recorte virtual: NO duplica bytes, solo marca un rango del medio original. */
export interface Clip {
  id: string;
  mediaId: string;
  startSec: number;
  endSec: number;
  title: string;
  createdAt: number;
}

/** Una unidad de práctica: normalmente una frase / cue. */
export interface Round {
  id: string;
  clipId: string;
  index: number;
  startSec: number;
  endSec: number;
  text: string;
  ipa?: string;
  /**
   * Tramo fijado a mano desde la práctica, en tiempos absolutos del medio.
   *
   * `startSec` / `endSec` siguen siendo los del subtítulo y no se tocan: así
   * volver al afinado automático es borrar estos dos campos, sin copias ni
   * migraciones. Cada lado va por su cuenta a propósito — al mover la
   * frontera con la ronda vecina solo queda fijado ese lado, y el otro se
   * sigue afinando solo contra el audio.
   */
  manualStartSec?: number;
  manualEndSec?: number;
  /** OPFS: audio del modelo extraído o generado por TTS. */
  modelAudioRef?: string;
  /** OPFS: F0 + envolvente de energía del modelo. */
  analysisRef?: string;
  /** Voz y entrega con que se generó `modelAudioRef` (§4.3). */
  ttsProvider?: string;
  ttsVoice?: string;
  ttsStyle?: string;
}

export type ScoreComponentKey =
  | "timing"
  | "intonation"
  | "durationMatch"
  | "rhythmShape";

export interface Score {
  total: number; // 0-100
  /** Solo los componentes que se han podido calcular de verdad. */
  components: Partial<Record<ScoreComponentKey, number>>;
  /** Lista de los presentes; el total se renormaliza sobre ellos (§13.9). */
  present: ScoreComponentKey[];
  weights: Record<ScoreComponentKey, number>;
  engineVersion: number;
  detail: {
    durTakeSec: number;
    durModelSec: number;
    rangeModelSt: number;
    rangeTakeSt: number;
    pausesModel: number;
    pausesTake: number;
  };
  tip?: string;
}

export interface Take {
  id: string;
  roundId: string;
  createdAt: number;
  /** OPFS. */
  audioRef: string;
  /** Mime real del MediaRecorder (audio/mp4 en Safari, audio/webm en Chrome). */
  mime: string;
  durationSec: number;
  /** Desfase de latencia de grabación estampado al capturar (ms). */
  latencyOffsetMs: number;
  score?: Score;
  /** OPFS: F0 + envolvente de energía de esta toma. */
  analysisRef?: string;
  kept: boolean;
}

export type ShowText = "always" | "fade" | "never";

export interface Practice {
  id: string;
  title: string;
  clipId: string;
  mode: PracticeMode;
  roundIds: string[];
  showText: ShowText;
  createdAt: number;
  lastPracticedAt?: number;
  lastScore?: number;
  /** Vueltas completas dadas. Gobierna la escalera de texto (§7.A). */
  completedLaps?: number;
}

/* --- Añadidos internos (no forman parte de la API pública del prompt) --- */

/** Handle de archivo persistido para reabrir sin volver a seleccionar. */
export interface StoredFileHandle {
  id: string;
  handle: FileSystemFileHandle;
  fileName: string;
  createdAt: number;
}

/** Fila del "libro de bytes": todo blob en OPFS tiene una entrada aquí. */
export type BlobCategory =
  | "media" // Medios importados
  | "tts" // Voces generadas
  | "recording" // Grabaciones
  | "export" // Recortes exportados
  | "analysis" // Análisis y picos
  | "model" // Modelos de IA descargados
  | "transcript"; // Transcripciones

export interface BlobRecord {
  path: string; // ruta OPFS, clave primaria
  category: BlobCategory;
  bytes: number;
  createdAt: number;
  /** Referencia lógica opcional (mediaId / roundId / takeId). */
  ownerId?: string;
}

export interface IpaCacheRow {
  key: string; // `${lang}\0${word}`, con \0 de separador
  lang: string;
  word: string;
  ipa: string;
  stress?: number[];
}

export interface SettingsState {
  targetLanguage: string;
  ipaDialect: string;
  defaultRate: number;
  rounds: number;
  passThreshold: number;
  showText: ShowText;
  theme: "system" | "light" | "dark";
  fontSize: number;
  usesHeadphones: boolean | null;
  /** Resaltado tipo karaoke del texto mientras suena el modelo. */
  karaoke: boolean;
  micLatencyOffsetMs: number | null;
  /**
   * Margen extra al final de cada frase, en ms. Los cortes ya se afinan solos
   * contra el audio; esto es para cuando el siguiente hablante entra pisando
   * y no hay silencio al que estirarse.
   */
  phraseTailMs: number;
  scoreWeights: {
    intonation: number;
    timing: number;
    rhythmShape: number;
    durationMatch: number;
  };
}
