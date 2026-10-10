import { useState, type FormEvent } from "react";
import { api, clearToken, describeError, setToken } from "../lib/api";

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
      await api.taxonomy();
      onSignedIn();
    } catch (caught) {
      clearToken();
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (import.meta.env.PROD && !["localhost", "127.0.0.1"].includes(globalThis.location.hostname)) {
    return (
      <main className="signin">
        <h1>ログインを確認してください</h1>
        <p>管理画面の認証が切れたか、アクセスが認められていません。</p>
        <a className="button primary" href="/cdn-cgi/access/login">
          Cloudflareでログインし直す
        </a>
      </main>
    );
  }
  return (
    <main className="signin">
      <h1>Tomokichi Diary Admin</h1>
      <p className="muted">シングルサインオンが有効な環境では、この画面は表示されません。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>管理トークン</span>
          <input
            type="password"
            value={value}
            autoComplete="current-password"
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          この端末で記憶する
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || value.trim() === ""}>
          {busy ? "確認中…" : "サインイン"}
        </button>
      </form>
    </main>
  );
}
