const TIMELINE_MAX_LIMIT = 100;
const TIMELINE_STEP = 20;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PoolCursor = { sort: string; value: string | null; id: string };
export type DetailCollectionCursor = { collection: string; value: string; id: string; isPrimary?: boolean };

export function encodePoolCursor(cursor: PoolCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodePoolCursor(value: string, sort: string): PoolCursor {
  try {
    if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) throw new Error();
    const encoded = Buffer.from(value, "base64url");
    if (encoded.toString("base64url") !== value) throw new Error();
    const cursor = JSON.parse(encoded.toString("utf8")) as Partial<PoolCursor>;
    if (cursor.sort !== sort || typeof cursor.id !== "string" || !UUID_PATTERN.test(cursor.id) || (cursor.value !== null && typeof cursor.value !== "string")) throw new Error();
    return cursor as PoolCursor;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export function encodeDetailCollectionCursor(cursor: DetailCollectionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDetailCollectionCursor(value: string, collection: string): DetailCollectionCursor {
  try {
    if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) throw new Error();
    const encoded = Buffer.from(value, "base64url");
    if (encoded.toString("base64url") !== value) throw new Error();
    const cursor = JSON.parse(encoded.toString("utf8")) as Partial<DetailCollectionCursor>;
    if (
      cursor.collection !== collection ||
      typeof cursor.value !== "string" ||
      typeof cursor.id !== "string" ||
      !UUID_PATTERN.test(cursor.id) ||
      (cursor.isPrimary !== undefined && typeof cursor.isPrimary !== "boolean")
    ) throw new Error();
    if (Number.isNaN(Date.parse(cursor.value))) throw new Error();
    return cursor as DetailCollectionCursor;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export function nextTimelineLimit(limit: number, hasMore: boolean): number | null {
  if (!hasMore || limit >= TIMELINE_MAX_LIMIT) return null;
  return Math.min(limit + TIMELINE_STEP, TIMELINE_MAX_LIMIT);
}
