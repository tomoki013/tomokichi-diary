export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;

export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function extensionFor(mimeType: string): string {
  return (
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
      "image/gif": "gif",
    }[mimeType] ?? "bin"
  );
}

export interface ImageContent {
  mimeType: string;
  width: number | null;
  height: number | null;
}

/** Check signatures and bounded container structure without a native Worker decoder. */
export function inspectImage(body: ArrayBuffer): ImageContent | null {
  const b = new Uint8Array(body);
  const v = new DataView(body);
  const ascii = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  const result = (
    mimeType: string,
    width: number | null,
    height: number | null,
  ): ImageContent | null =>
    width !== null &&
    height !== null &&
    (width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS)
      ? null
      : { mimeType, width, height };
  if (b.length < 12) return null;
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") {
    if (b.length < 45 || v.getUint32(8) !== 13 || ascii(12, 4) !== "IHDR") return null;
    let at = 8;
    let data = false;
    while (at + 12 <= b.length) {
      const size = v.getUint32(at);
      const kind = ascii(at + 4, 4);
      if (size > b.length - at - 12) return null;
      let crc = 0xffffffff;
      for (let i = at + 4; i < at + 8 + size; i++) {
        crc ^= b[i]!;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== v.getUint32(at + 8 + size)) return null;
      if (kind === "IDAT" && size > 0) data = true;
      at += 12 + size;
      if (kind === "IEND")
        return data && size === 0 && at === b.length
          ? result("image/png", v.getUint32(16), v.getUint32(20))
          : null;
    }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    let width = 0;
    let height = 0;
    while (at + 4 < b.length) {
      if (b[at++] !== 0xff) return null;
      while (b[at] === 0xff) at++;
      const marker = b[at++]!;
      if (marker === 0xda)
        return width && height && b.at(-2) === 0xff && b.at(-1) === 0xd9
          ? result("image/jpeg", width, height)
          : null;
      if (at + 2 > b.length) return null;
      const length = v.getUint16(at);
      if (length < 2 || at + length > b.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return null;
        height = v.getUint16(at + 3);
        width = v.getUint16(at + 5);
      }
      at += length;
    }
    return null;
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    if (v.getUint32(4, true) + 8 !== b.length) return null;
    let at = 12;
    let width: number | null = null;
    let height: number | null = null;
    let data = false;
    while (at + 8 <= b.length) {
      const kind = ascii(at, 4);
      const size = v.getUint32(at + 4, true);
      if (size > b.length - at - 8) return null;
      if (kind === "VP8X" && size === 10) {
        width = 1 + b[at + 12]! + (b[at + 13]! << 8) + (b[at + 14]! << 16);
        height = 1 + b[at + 15]! + (b[at + 16]! << 8) + (b[at + 17]! << 16);
      } else if (kind === "VP8 " && size >= 10 && ascii(at + 11, 3) === "\x9d\x01\x2a") {
        width ??= v.getUint16(at + 14, true) & 0x3fff;
        height ??= v.getUint16(at + 16, true) & 0x3fff;
        data = true;
      } else if (kind === "VP8L" && size >= 5 && b[at + 8] === 0x2f) {
        const bits = v.getUint32(at + 9, true);
        width ??= (bits & 0x3fff) + 1;
        height ??= ((bits >>> 14) & 0x3fff) + 1;
        data = true;
      } else if (kind === "ANMF" && size > 16) data = true;
      at += 8 + size + (size % 2);
    }
    return data && at === b.length && width && height ? result("image/webp", width, height) : null;
  }
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    if (b.length < 14) return null;
    let at = 13 + (b[10]! & 0x80 ? 3 * (1 << ((b[10]! & 7) + 1)) : 0);
    let data = false;
    const blocks = () => {
      while (at < b.length) {
        const size = b[at++]!;
        if (size === 0) return true;
        at += size;
      }
      return false;
    };
    while (at < b.length) {
      const marker = b[at++]!;
      if (marker === 0x3b)
        return data && at === b.length
          ? result("image/gif", v.getUint16(6, true), v.getUint16(8, true))
          : null;
      if (marker === 0x21) {
        at++;
        if (!blocks()) return null;
      } else if (marker === 0x2c) {
        if (at + 9 >= b.length) return null;
        const flags = b[at + 8]!;
        at += 9 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
        if (at >= b.length || b[at]! < 2 || b[at]! > 8) return null;
        at++;
        if (!blocks()) return null;
        data = true;
      } else return null;
    }
    return null;
  }
  if (ascii(4, 4) === "ftyp") {
    let at = 0;
    let avif = false;
    let meta = false;
    let data = false;
    while (at + 8 <= b.length) {
      const size = v.getUint32(at);
      const kind = ascii(at + 4, 4);
      if (size < 8 || size > b.length - at) return null;
      if (kind === "ftyp") {
        if (size < 16) return null;
        avif = ["avif", "avis"].includes(ascii(at + 8, 4));
        for (let brand = at + 16; brand + 4 <= at + size; brand += 4)
          avif ||= ["avif", "avis"].includes(ascii(brand, 4));
      }
      meta ||= kind === "meta" && size > 12;
      data ||= kind === "mdat" && size > 8;
      at += size;
    }
    return avif && meta && data && at === b.length ? result("image/avif", null, null) : null;
  }
  return null;
}
