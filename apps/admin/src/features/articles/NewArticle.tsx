import { useState } from "react";
import { useAction, useTitle } from "../../data/hooks";
import { op } from "../../data/client";
import { go, href } from "../../app/router";
import { Button, Page, TextArea, TextInput } from "../../ui/parts";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Starts a draft: the URL is fixed here, everything else can change later. */
export function NewArticle({ kind }: { kind: "article" | "page" }) {
  const page = kind === "page";
  useTitle(page ? "新しい固定ページ" : "新しい記事");
  const [slug, setSlug] = useState("");
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const { busy, run } = useAction();
  const finalPath = path || (slug ? (page ? `/${slug}` : `/posts/${slug}`) : "");
  async function create() {
    const created = await run(
      "create",
      () =>
        op("article.create", {
          slug,
          path: finalPath,
          kind,
          title,
          summary,
          bodyMarkdown: "（本文をここに書く）",
          seoTitleOverride: null,
          seoDescriptionOverride: null,
          changeSummary: "下書きを作成",
        }),
      { touches: ["article", "home"] },
    );
    if (created) go(href.article(created.id));
  }
  return (
    <Page
      title={page ? "新しい固定ページ" : "新しい記事"}
      back={{ href: href.articles(), label: "記事" }}
    >
      <div className="panel">
        <div className="panel__body" style={{ paddingTop: 12 }}>
          <TextInput label="タイトル" value={title} onChange={setTitle} max={120} />
          <TextArea
            label="要約（カードや検索結果に出る一文）"
            value={summary}
            onChange={setSummary}
            max={400}
            rows={2}
          />
          <TextInput
            label="slug"
            value={slug}
            onChange={setSlug}
            hint={
              slug && !slugPattern.test(slug)
                ? "英小文字・数字・ハイフンだけにしてください"
                : "あとから変えられません"
            }
          />
          <TextInput
            label="URL"
            value={finalPath}
            onChange={setPath}
            hint="ふつうは slug から決まります"
          />
          <Button
            kind="primary"
            busy={busy === "create"}
            disabled={!title || !summary || !slugPattern.test(slug) || !finalPath}
            onClick={() => void create()}
          >
            下書きを作る
          </Button>
        </div>
      </div>
    </Page>
  );
}
