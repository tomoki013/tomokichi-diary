import { openSync, readSync, closeSync, statSync } from "node:fs";

/**
 * Intrinsic dimensions from the file header. Only the formats the archive
 * actually contains are handled, and an unknown file yields nulls rather than a
 * guess — `width`/`height` exist to prevent layout shift, not to be invented.
 */
export interface ImageSize {
  width: number | null;
  height: number | null;
  size: number;
}

export function readImageSize(path: string): ImageSize {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    readSync(fd, head, 0, head.length, 0);

    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), size };
    }
    if (head[0] === 0xff && head[1] === 0xd8) {
      const jpeg = readJpegSize(head);
      if (jpeg) return { ...jpeg, size };
    }
    if (
      head.subarray(0, 4).toString("ascii") === "RIFF" &&
      head.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      const webp = readWebpSize(head);
      if (webp) return { ...webp, size };
    }
    return { width: null, height: null, size };
  } finally {
    closeSync(fd);
  }
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1]!;
    // SOF0-SOF15, excluding the DHT/JPG/DAC markers that share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

function readWebpSize(buffer: Buffer): { width: number; height: number } | null {
  const format = buffer.subarray(12, 16).toString("ascii");
  if (format === "VP8X")
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  if (format === "VP8 ")
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (format === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
