import { useState } from "react";
import type { ConnectionDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { formatDateTime } from "../../lib/labels";
import { Badge, Button, Empty, Loaded, Page, Panel, TextInput, confirmed } from "../../ui/parts";

const issuerLabel: Record<ConnectionDto["issuer"], string> = {
  operator: "管理",
  "operator-legacy": "管理（旧URL）",
  analytics: "分析",
  "analytics-legacy": "分析（旧URL）",
};

/** Who is connected to the private MCP servers, and the way to cut one off. */
export function Connections() {
  useTitle("MCP 接続");
  const list = useOp("connection.list");
  return (
    <Page title="MCP 接続" back={{ href: href.more(), label: "その他" }}>
      <p className="muted">
        管理用 MCP
        は管理画面と同じことができます（削除・問い合わせ・事実の確認・接続の失効を除く）。名前は接続先の自己申告なので、戻り先を見て確かめてから名前を付けてください。
      </p>
      <Loaded resource={list}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty>接続はありません。</Empty>
          ) : (
            data.items.map((item) => <Connection key={`${item.issuer}:${item.id}`} item={item} />)
          )
        }
      </Loaded>
    </Page>
  );
}

function Connection({ item }: { item: ConnectionDto }) {
  const [name, setName] = useState(item.clientName);
  const { busy, run } = useAction();
  const writes = item.scopes.includes("operator:write");
  return (
    <Panel
      title={item.clientName}
      hint={issuerLabel[item.issuer]}
      actions={
        <Badge tone={item.clientTrust === "confirmed" ? "ok" : "warn"}>
          {item.clientTrust === "confirmed" ? "確認済み" : "自己申告"}
        </Badge>
      }
    >
      <p className="muted">
        戻り先 {item.redirectHost ?? "不明"} · {writes ? "読み書き" : "読み取り"} · 許可{" "}
        {formatDateTime(item.approvedAt)} · 最終利用 {formatDateTime(item.lastUsedAt)} · 期限{" "}
        {formatDateTime(item.expiresAt)}
      </p>
      <div className="inline">
        <TextInput label="表示名" value={name} onChange={setName} max={80} />
        <Button
          busy={busy === "label"}
          disabled={!name.trim() || !item.redirectHost}
          onClick={() =>
            void run(
              "label",
              () =>
                op("connection.label", {
                  clientId: item.clientId,
                  redirectHost: item.redirectHost ?? "",
                  displayName: name,
                }),
              { done: "名前を付けました", touches: ["connection"] },
            )
          }
        >
          名前を確定
        </Button>
      </div>
      <div className="inline">
        <a href={href.activity()}>操作ログ</a>
        <Button
          kind="danger"
          busy={busy === "revoke"}
          onClick={() =>
            confirmed(
              `「${item.clientName}」の接続を失効させます。発行済みのトークンも使えなくなります。`,
            ) &&
            void run(
              "revoke",
              () =>
                op("connection.revoke", {
                  issuer: item.issuer,
                  grantId: item.id,
                  confirm: "revoke",
                }),
              {
                done: "失効させました",
                touches: ["connection"],
              },
            )
          }
        >
          失効させる
        </Button>
      </div>
    </Panel>
  );
}
