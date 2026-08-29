import type { MediaUrlResolver, ObjectStorage, StoredObject } from "@tomokichi/application";

/** The slice of the R2 binding this adapter uses. */
export interface R2Like {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size: number } | null>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<unknown>;
}

export function createR2Storage(bucket: R2Like): ObjectStorage {
  return {
    put: async (key, body, mimeType) => {
      await bucket.put(key, body, { httpMetadata: { contentType: mimeType } });
    },
    get: async (key): Promise<StoredObject | null> => {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: await object.arrayBuffer(),
        mimeType: object.httpMetadata?.contentType ?? "application/octet-stream",
        size: object.size,
      };
    },
    delete: async (key) => {
      await bucket.delete(key);
    },
    exists: async (key) => (await bucket.head(key)) !== null,
  };
}

/**
 * Storage keys become public URLs here and nowhere else, so moving to another
 * object store is a configuration change rather than a data migration
 * (instruction §54).
 */
export function createMediaUrlResolver(baseUrl: string): MediaUrlResolver {
  const base = baseUrl.replace(/\/+$/, "");
  return { resolve: (storageKey) => `${base}/${storageKey.replace(/^\/+/, "")}` };
}

/** In-memory storage for tests and for builds that must not touch a live bucket. */
export function createMemoryStorage(): ObjectStorage & { readonly keys: () => readonly string[] } {
  const objects = new Map<string, StoredObject>();
  return {
    put: async (key, body, mimeType) => {
      objects.set(key, { body, mimeType, size: body.byteLength });
    },
    get: async (key) => objects.get(key) ?? null,
    delete: async (key) => {
      objects.delete(key);
    },
    exists: async (key) => objects.has(key),
    keys: () => [...objects.keys()],
  };
}
