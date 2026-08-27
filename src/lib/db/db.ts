import Dexie, { type EntityTable } from "dexie";
import type {
  BlobRecord,
  Clip,
  IpaCacheRow,
  MediaItem,
  Practice,
  Round,
  StoredFileHandle,
  Take,
  Transcript,
} from "@/lib/types";

/**
 * Esquema Dexie. Dexie = índice + "libro de bytes" (tabla `blobs`);
 * los bytes reales viven en OPFS. Toda ampliación de esquema en fases
 * futuras se añade como `.version(n+1)` con su `.upgrade()`.
 */
export class ShadowingDB extends Dexie {
  media!: EntityTable<MediaItem, "id">;
  transcripts!: EntityTable<Transcript, "id">;
  clips!: EntityTable<Clip, "id">;
  rounds!: EntityTable<Round, "id">;
  takes!: EntityTable<Take, "id">;
  practices!: EntityTable<Practice, "id">;
  fileHandles!: EntityTable<StoredFileHandle, "id">;
  blobs!: EntityTable<BlobRecord, "path">;
  ipaCache!: EntityTable<IpaCacheRow, "key">;

  constructor() {
    super("shadowing");
    this.version(1).stores({
      media: "id, language, createdAt",
      transcripts: "id, mediaId, origin",
      clips: "id, mediaId, createdAt",
      rounds: "id, clipId, [clipId+index]",
      takes: "id, roundId, createdAt, kept",
      practices: "id, clipId, createdAt, lastPracticedAt",
      fileHandles: "id, createdAt",
      blobs: "path, category, ownerId, createdAt",
      ipaCache: "key, lang",
    });
  }
}

let _db: ShadowingDB | null = null;

export function db(): ShadowingDB {
  if (!_db) _db = new ShadowingDB();
  return _db;
}
