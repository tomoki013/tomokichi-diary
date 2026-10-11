export type ImageFormat = "webp" | "jpeg" | "png";
export interface ConvertOptions {
  format: ImageFormat;
  quality: number;
  maxWidth?: number;
}

/** Explicit export today; automatic compression can reuse this transform later. */
export async function convertImage(source: Blob, options: ConvertOptions): Promise<Blob> {
  if (
    !Number.isFinite(options.quality) ||
    options.quality < 0.1 ||
    options.quality > 1 ||
    (options.maxWidth !== undefined &&
      (!Number.isInteger(options.maxWidth) || options.maxWidth < 1))
  )
    throw new Error("品質・最大幅を確認してください");
  const bitmap = await createImageBitmap(source);
  try {
    if (bitmap.width * bitmap.height > 100_000_000) throw new Error("画像サイズが大きすぎます");
    const width = Math.min(bitmap.width, options.maxWidth ?? bitmap.width);
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像を変換できませんでした");
    if (options.format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const type = `image/${options.format}`;
    const output = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("画像を変換できませんでした"))),
        type,
        options.quality,
      ),
    );
    if (output.type !== type) throw new Error("このブラウザは指定形式への変換に対応していません");
    return output;
  } finally {
    bitmap.close();
  }
}

export function downloadImage(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
