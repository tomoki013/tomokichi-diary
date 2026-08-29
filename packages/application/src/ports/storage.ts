/**
 * The only thing the Core knows about object storage. R2, S3 or a local folder
 * all satisfy it, so moving providers never reaches a use case.
 */
export interface StoredObject {
  readonly body: ArrayBuffer;
  readonly mimeType: string;
  readonly size: number;
}

export interface ObjectStorage {
  put(key: string, body: ArrayBuffer, mimeType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Turns an opaque storage key into a public URL. Keeping this out of the data
 * model is what lets the storage provider change without rewriting rows
 * (instruction §54).
 */
export interface MediaUrlResolver {
  resolve(storageKey: string): string;
}
