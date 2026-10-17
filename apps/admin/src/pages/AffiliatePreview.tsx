import type { AffiliateOffer } from "@tomokichi/contracts";
function imageUrl(value: string | null | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
/** Preview links are deliberately inert; offer text is always escaped by React. */
export function AffiliatePreview({ offer }: { offer?: AffiliateOffer }) {
  const image = imageUrl(offer?.imageUrl);
  const title = offer?.heading || offer?.name || "案件未割当";
  return (
    <aside className="affiliate-preview" aria-label="アフィリエイト予定・管理画面限定プレビュー">
      <small>広告・提携サービス紹介（プレビュー専用・本番非表示）</small>
      {offer?.format === "photo_card" &&
        (image ? (
          <img src={image} alt={title} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <p className="muted">画像未登録</p>
        ))}
      {offer?.format === "text" ? (
        <p>
          <strong>{title}</strong>（テキストリンク・操作無効）
        </p>
      ) : (
        <>
          <h3>{title}</h3>
          <p>{offer?.description || "利用したサービスの紹介をここに準備できます。"}</p>
          <span className="badge">
            {offer?.url ? "予約情報を見る（操作無効）" : "リンク未登録"}
          </span>
        </>
      )}
    </aside>
  );
}
