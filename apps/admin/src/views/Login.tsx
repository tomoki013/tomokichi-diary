import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";

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
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setToken(value);
    try {
      await api.listArticles();
      onAuthenticated();
    } catch (error) {
      setToken("");
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
        <button className="primary" type="submit" disabled={busy || value === ""}>
          {busy ? "確認中…" : "サインイン"}
        </button>
      </form>
    </main>
  );
}
