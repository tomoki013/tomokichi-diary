import { useState } from "react";
import { ACTIVITY_RESULTS, operations, type ActivityItemDto } from "@tomokichi/contracts";
import { useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { formatDateTime } from "../../lib/labels";
import { Badge, Button, Empty, Loaded, Page, Rows, Row, Select, TextInput } from "../../ui/parts";

const sourceLabel: Record<string, string> = {
  admin: "管理画面",
  "remote-mcp": "MCP",
  "local-mcp": "ローカル MCP",
  system: "システム",
};
const resultTone = {
  succeeded: "ok",
  requested: "accent",
  rejected: "warn",
  failed: "danger",
} as const;
const resultLabel = {
  succeeded: "成功",
  requested: "依頼済み",
  rejected: "拒否",
  failed: "失敗",
} as const;

/** Every operation run, by whom and from where. Short descriptions come from the catalogue. */
const describe = (action: string) => {
  const spec = (operations as Record<string, { description: string } | undefined>)[action];
  // The first sentence of the catalogue's Japanese description, e.g. 「記事の下書きを保存します」.
  return spec ? (spec.description.split(/[。（(]/)[0] ?? action) : action;
};

export function Activity({ targetType, targetId }: { targetType?: string; targetId?: string }) {
  useTitle("操作ログ");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<"" | (typeof ACTIVITY_RESULTS)[number]>("");
  const [client, setClient] = useState("");
  const activity = useOp("activity.list", {
    page,
    limit: 50,
    ...(result ? { result } : {}),
    ...(client.trim() ? { client: client.trim() } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
  });
  return (
    <Page title="操作ログ" back={{ href: href.more(), label: "その他" }}>
      {targetId && (
        <p className="muted">
          {targetType} {targetId} の操作だけ表示 · <a href={href.activity()}>すべて表示</a>
        </p>
      )}
      <div className="inline">
        <Select
          label="結果"
          value={result}
          options={[
            { value: "", label: "すべて" },
            ...ACTIVITY_RESULTS.map((r) => ({ value: r, label: resultLabel[r] })),
          ]}
          onChange={(value) => {
            setResult(value);
            setPage(1);
          }}
        />
        <TextInput
          label="接続先"
          value={client}
          onChange={setClient}
          placeholder="名前・ID・unknown"
        />
      </div>
      <Loaded resource={activity} lines={8}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty>記録はありません。</Empty>
          ) : (
            <>
              <Rows>
                {data.items.map((item: ActivityItemDto) => (
                  <Row
                    key={item.id}
                    title={describe(item.action)}
                    meta={`${formatDateTime(item.occurredAt)} · ${sourceLabel[item.source] ?? item.source}${item.clientName ? ` · ${item.clientName}` : ""}${item.mcpToolName ? ` · ${item.mcpToolName}` : ""}${item.targetId ? ` · ${item.targetType} ${item.targetId.slice(0, 8)}` : ""}`}
                    aside={
                      <Badge tone={resultTone[item.result as keyof typeof resultTone] ?? "neutral"}>
                        {resultLabel[item.result as keyof typeof resultLabel] ?? item.result}
                      </Badge>
                    }
                  />
                ))}
              </Rows>
              <div className="spread">
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  前へ
                </Button>
                <span className="muted">
                  {page}/{Math.max(1, data.pages)}（{data.total}件）
                </span>
                <Button disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
                  次へ
                </Button>
              </div>
            </>
          )
        }
      </Loaded>
    </Page>
  );
}
