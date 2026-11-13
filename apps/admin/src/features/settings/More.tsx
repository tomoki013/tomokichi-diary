import { useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { Badge, Page, Row, Rows } from "../../ui/parts";

/** Everything that is not on the bottom bar, in one list. */
export function More() {
  useTitle("その他");
  const pending = useOp("knowledge.pending");
  const count = pending.data?.items.length ?? 0;
  return (
    <Page title="その他">
      <h2>サイトをつくる</h2>
      <Rows>
        <Row href={href.series()} title="シリーズ・タグ" meta="シリーズ、旅程、タグ" />
        <Row href={href.rankings()} title="ランキング" meta="トップページのともきち的ランキング" />
        <Row
          href={href.searchWords()}
          title="検索の別名"
          meta="読みや別の書き方でも記事が見つかるようにする"
        />
        <Row
          href={href.articles("pages")}
          title="固定ページ"
          meta="プライバシーポリシー・利用規約など"
        />
        <Row
          href={href.knowledge()}
          title="旅の知識"
          meta="記事の事実の確認"
          aside={count > 0 ? <Badge tone="accent">確認待ち {count}</Badge> : undefined}
        />
      </Rows>
      <h2>運営</h2>
      <Rows>
        <Row href={href.ads()} title="収益化" meta="広告・位置テスト・アフィリエイト" />
        <Row href={href.analytics()} title="分析" meta="PV・検索・収益・いいね" />
        <Row href={href.inquiries()} title="問い合わせ" meta="読者からのメッセージと返信" />
      </Rows>
      <h2>設定</h2>
      <Rows>
        <Row href={href.site()} title="サイト反映" meta="公開の状況と再実行" />
        <Row href={href.connections()} title="MCP 接続" meta="ChatGPT・Claude などの接続" />
        <Row href={href.activity()} title="操作ログ" meta="誰がどの経路で何をしたか" />
      </Rows>
    </Page>
  );
}
