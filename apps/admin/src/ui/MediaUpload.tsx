import { useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { useAction } from "../data/hooks";
import { IMAGE_ACCEPT, uploadImage } from "../lib/media-upload";
import { convertImage } from "../lib/media-convert";
import { Button, Check, TextInput } from "./parts";

const slugFrom = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Adds a photo to the library. The same file twice is found by its hash and
 * reused. Large photos can be shrunk to WebP in the browser first.
 */
export function MediaUpload({ onUploaded }: { onUploaded?: (asset: MediaAssetDto) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState("");
  const [shrink, setShrink] = useState(true);
  const { busy, run } = useAction();
  async function upload() {
    if (!file) return;
    const result = await run(
      "upload",
      async () => {
        let body: File = file;
        if (shrink && file.type !== "image/gif" && file.size > 600 * 1024) {
          const converted = await convertImage(file, {
            format: "webp",
            maxWidth: 2400,
            quality: 0.85,
          });
          body = new File([converted], file.name.replace(/\.[^.]+$/, ".webp"), {
            type: "image/webp",
          });
        }
        return uploadImage(body, slug);
      },
      { touches: ["media"] },
    );
    if (!result) return;
    setFile(null);
    setSlug("");
    onUploaded?.(result.asset);
  }
  return (
    <div className="stack">
      <input
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label="写真ファイル"
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          setFile(picked);
          if (picked && !slug) setSlug(slugFrom(picked.name));
        }}
      />
      {file && (
        <>
          <TextInput
            label="公開画像Slug"
            value={slug}
            onChange={setSlug}
            hint="写真の URL になります（英小文字・数字・ハイフン）"
          />
          <Check
            label="大きい写真は WebP に縮めてから上げる"
            checked={shrink}
            onChange={setShrink}
          />
          <Button
            kind="primary"
            busy={busy === "upload"}
            disabled={!slug.trim()}
            onClick={() => void upload()}
          >
            アップロード
          </Button>
        </>
      )}
    </div>
  );
}
