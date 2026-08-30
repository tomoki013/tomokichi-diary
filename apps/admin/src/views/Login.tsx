import { useState, type FormEvent } from "react";
import { api, clearToken, setToken } from "../api";

/**
 * The admin authenticates with the same shared secret the API expects. The
 * token is verified against the API before it is stored, so a wrong value
 * fails here rather than on every later request.
 */
export function Login({
  onAuthenticated,
  onError,
}: {
  onAuthenticated: () => void;
  onError: (error: unknown) => void;
}) {
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setToken(value, remember);
    try {
      await api.listArticles();
      onAuthenticated();
    } catch (error) {
      clearToken();
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: "22rem", marginTop: "18vh" }}>
      <h1 style={{ fontSize: "1.1rem" }}>Tomokichi Diary Admin</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          <span>管理トークン</span>
          <input
            type="password"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input
            type="checkbox"
            checked={remember}
            style={{ width: "auto" }}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span style={{ margin: 0 }}>この端末で記憶する</span>
        </label>
        <button className="primary" type="submit" disabled={busy || value === ""}>
          {busy ? "確認中…" : "サインイン"}
        </button>
      </form>
    </main>
  );
}
