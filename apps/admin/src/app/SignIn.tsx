import { useState, type FormEvent } from "react";
import { clearToken, describeError, op, setToken } from "../data/client";
import { Button, Check, TextInput } from "../ui/parts";

/**
 * Only seen without Cloudflare Access in front (local development): the
 * shared admin token is checked against the API before it is kept.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setToken(value.trim(), remember);
    try {
      await op("publication.status");
      onSignedIn();
    } catch (caught) {
      clearToken();
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (import.meta.env.PROD && !["localhost", "127.0.0.1"].includes(globalThis.location.hostname))
    return (
      <main className="signin">
        <h1>ログインを確認してください</h1>
        <p>管理画面の認証が切れたか、アクセスが認められていません。</p>
        <a className="button button--primary" href="/cdn-cgi/access/login">
          Cloudflareでログインし直す
        </a>
      </main>
    );
  return (
    <main className="signin">
      <h1>Diary Admin</h1>
      <p className="muted">シングルサインオンが有効な環境では、この画面は表示されません。</p>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <TextInput
          label="管理トークン"
          type="password"
          value={value}
          onChange={setValue}
          required
        />
        <Check label="このブラウザに記憶する" checked={remember} onChange={setRemember} />
        {error && <p className="error-box">{error}</p>}
        <Button type="submit" kind="primary" busy={busy}>
          サインイン
        </Button>
      </form>
    </main>
  );
}
