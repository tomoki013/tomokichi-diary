const publishMessages: Record<string, string> = {
  "body must be at least 200 characters": "本文を200文字以上入力してください",
  "a cover image is required": "カバー画像を選んでください",
  "cover image requires alt text": "カバー画像の代替テキストを入力してください",
  "title is required": "タイトルを入力してください",
  "summary is required": "要約を入力してください",
  "a canonical route is required": "記事のURLを設定してください",
  "scheduled publication time has not been reached": "予約日時になると公開されます",
  "archived articles cannot be published": "アーカイブした記事は公開できません",
};
const brokenLink = "internal link target does not exist: ";
const imageAlt = "body image requires alt text: ";
export const publishProblem = (message: string) =>
  message.startsWith(brokenLink)
    ? `本文のリンク先 ${message.slice(brokenLink.length)} が存在しません。URLを確認してください`
    : message.startsWith(imageAlt)
      ? `本文の画像 ${message.slice(imageAlt.length)} に代替テキストがありません。![ここ](URL) に説明を書いてください`
      : (publishMessages[message] ?? message);
