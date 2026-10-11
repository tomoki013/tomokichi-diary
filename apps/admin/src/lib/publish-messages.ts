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
export const publishProblem = (message: string) => publishMessages[message] ?? message;
