import { useState } from "react";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { formatSearchWords, parseSearchWords } from "../../lib/search-words";
import { Button, Loaded, Page, TextArea } from "../../ui/parts";

/**
 * Readings and other spellings the site search answers to. Never shown on the
 * site: an article that mentions a word, body included, is found by every
 * spelling on its line.
 */
export function SearchWords() {
  useTitle("検索の別名");
  const list = useOp("search.words");
  return (
    <Page title="検索の別名" back={{ href: href.more(), label: "その他" }}>
      <p className="muted">
        サイト内検索だけに使います。サイトには表示されません。題・要約・タグ・本文にその語が出てくる記事が、行にあるどの書き方でも見つかります。ひらがなとカタカナ、全角と半角、大文字と小文字は同じ扱いです。
      </p>
      <Loaded resource={list} lines={6}>
        {(data) => {
          const saved = formatSearchWords(data.items);
          // Remounts on a save, so the box shows the list as it was stored.
          return <Editor key={saved} saved={saved} />;
        }}
      </Loaded>
    </Page>
  );
}

function Editor({ saved }: { saved: string }) {
  const [text, setText] = useState(saved);
  const [problems, setProblems] = useState<string[]>([]);
  const { busy, run } = useAction();

  async function save() {
    const parsed = parseSearchWords(text);
    setProblems(parsed.problems);
    if (parsed.problems.length > 0) return;
    await run("save", () => op("search.saveWords", { words: parsed.items }), {
      done: "保存しました。サイトへの反映は「サイト反映」から",
      touches: ["search"],
    });
  }

  return (
    <>
      <TextArea
        label="1行に1語：語 = 読み、別の書き方"
        value={text}
        onChange={setText}
        rows={14}
        hint="例：CHAGEE = チャジー、霸王茶姬"
      />
      {problems.map((problem) => (
        <p key={problem} className="muted" role="alert">
          {problem}
        </p>
      ))}
      <Button kind="primary" busy={busy === "save"} onClick={() => void save()}>
        保存
      </Button>
    </>
  );
}
