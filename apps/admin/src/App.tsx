import { useCallback, useEffect, useState } from "react";
import { ApiError, api, clearToken } from "./api";
import { ArticleList } from "./views/ArticleList";
import { ArticleEditor } from "./views/ArticleEditor";
import { Messages } from "./views/Messages";
import { Login } from "./views/Login";
import { Toast, type ToastMessage } from "./components/Toast";

/**
 * Hash routing rather than a router dependency: the admin has two screens, and
 * a hash keeps it deployable as plain static files behind any host.
 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => globalThis.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = (): void => setHash(globalThis.location.hash.slice(1) || "/");
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();
  // `checking` covers the moment before we know whether Cloudflare Access has
  // already let us in, so the login form never flashes for an authorised user.
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    // With Access in front, an authorised browser is already authenticated and
    // there is nothing to type. Probing beats asking.
    api.listArticles().then(
      () => setAuthenticated(true),
      () => setAuthenticated(false),
    );
  }, []);

  const notify = useCallback((message: ToastMessage) => {
    setToast(message);
    globalThis.setTimeout(() => setToast(null), message.tone === "error" ? 8000 : 3000);
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      const detail =
        error instanceof ApiError
          ? `${error.code}: ${error.message}${error.issues.length > 0 ? ` (${error.issues.map((i) => i.path).join(", ")})` : ""}`
          : String(error);
      notify({ tone: "error", text: detail });
    },
    [notify],
  );

  const signOut = useCallback(() => {
    clearToken();
    setAuthenticated(false);
  }, []);

  if (authenticated === null) return <main className="muted">確認中…</main>;
  if (!authenticated) {
    return <Login onAuthenticated={() => setAuthenticated(true)} onError={reportError} />;
  }

  const editorMatch = /^\/articles\/(.+)$/.exec(route);

  return (
    <>
      <header className="bar">
        <h1>
          <a href="#/">Tomokichi Diary Admin</a>
        </h1>
        <a href="#/messages">お問い合わせ</a>
        <button
          onClick={() =>
            void api
              .health()
              .then(() => notify({ tone: "info", text: "API に接続できています" }), reportError)
          }
        >
          接続確認
        </button>
        <button onClick={signOut}>サインアウト</button>
      </header>
      <main>
        {editorMatch ? (
          <ArticleEditor id={editorMatch[1]!} notify={notify} onError={reportError} />
        ) : route === "/messages" ? (
          <Messages notify={notify} onError={reportError} />
        ) : (
          <ArticleList notify={notify} onError={reportError} />
        )}
      </main>
      {toast && <Toast message={toast} />}
    </>
  );
}
