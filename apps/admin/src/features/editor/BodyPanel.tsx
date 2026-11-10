import { useMemo, useRef, useState } from "react";
import {
  enhanceAppleMusic,
  enhanceInlineAffiliates,
  renderArticleMarkdown,
  replaceLoneLinks,
} from "@tomokichi/contracts";
import { insertAppleMusic } from "../../lib/apple-music";
import { insertMarkdownImage } from "../../lib/markdown-image";
import {
  approvedInlineAffiliateUrls,
  markersToPlaceholders,
  withAdMocks,
  type AdPreview,
} from "../../lib/ad-preview";
import { bodyStats } from "../../lib/draft";
import { MediaPicker } from "../../ui/MediaPicker";
import { Button, Panel } from "../../ui/parts";
import { useToast } from "../../ui/toast";

const SITE_ORIGIN = "https://tomokichidiary.com";
const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A site link alone in its paragraph becomes a card; the preview draws its place. */
function linkCardPreview(target: string, label: string): string | null {
  try {
    if (target.startsWith("#") || new URL(target, `${SITE_ORIGIN}/posts/`).origin !== SITE_ORIGIN)
      return null;
  } catch {
    return null;
  }
  return `<aside class="link-card-mock"><span>記事リンクカード</span><strong>${label}</strong><span>${escapeHtml(target)}</span></aside>`;
}

/**
 * The body, with a photo button and a preview drawn by the same functions as
 * the public page, so what is seen here is what readers get.
 */
export function BodyPanel({
  body,
  onChange,
  adPreview = null,
}: {
  body: string;
  onChange: (body: string) => void;
  adPreview?: AdPreview | null;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState(false);
  const toast = useToast();
  const stats = bodyStats(body);
  const html = useMemo(
    () =>
      preview
        ? replaceLoneLinks(
            enhanceInlineAffiliates(
              enhanceAppleMusic(
                withAdMocks(renderArticleMarkdown(markersToPlaceholders(body)), adPreview),
              ),
              approvedInlineAffiliateUrls(adPreview),
            ),
            linkCardPreview,
          )
        : "",
    [preview, body, adPreview],
  );
  const place = (next: { body: string; cursor: number }) => {
    onChange(next.body);
    requestAnimationFrame(() => area.current?.setSelectionRange(next.cursor, next.cursor));
  };
  return (
    <Panel
      id="body"
      title="本文"
      hint={`${stats.characters.toLocaleString()}字 · 約${stats.minutes}分`}
      actions={
        <>
          <Button kind="quiet" onClick={() => setPicking(true)}>
            写真
          </Button>
          <Button kind="quiet" onClick={() => setPreview((on) => !on)}>
            {preview ? "編集" : "プレビュー"}
          </Button>
        </>
      }
    >
      {preview ? (
        // Rendered by the site's own renderer from the author's Markdown.
        <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <textarea
          ref={area}
          className="body-input"
          aria-label="本文（Markdown）"
          value={body}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            const target = event.currentTarget;
            const placed = insertAppleMusic(body, target.selectionStart, target.selectionEnd, text);
            if (!placed) return;
            event.preventDefault();
            place(placed);
            toast.info("Apple Music のプレーヤーを入れました");
          }}
        />
      )}
      <p className="field__hint">
        Apple Music の共有 URL
        を貼るとプレーヤーになります。サイト内の記事リンクを1行で書くとカードになります。
      </p>
      {picking && (
        <MediaPicker
          title="本文に写真を入れる"
          onClose={() => setPicking(false)}
          onPick={(asset) => {
            setPicking(false);
            const at = area.current?.selectionStart ?? body.length;
            const end = area.current?.selectionEnd ?? body.length;
            place(insertMarkdownImage(body, at, end, asset.slugUrl ?? asset.url, ""));
            toast.info("写真を入れました。![ ] の中に説明を書いてください");
          }}
        />
      )}
    </Panel>
  );
}
