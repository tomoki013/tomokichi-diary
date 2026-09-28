import { useCallback, useEffect, useState } from "react";
import { ApiError, api, clearToken, getToken } from "./lib/api";
import { href, section } from "./lib/route";
import { useHashRoute } from "./ui/hooks";
import { Dashboard } from "./pages/Dashboard";
import { Articles } from "./pages/Articles";
import { ArticleEditor } from "./pages/editor/ArticleEditor";
import { MediaLibrary } from "./pages/MediaLibrary";
import { Routes } from "./pages/Routes";
import { Inquiries } from "./pages/inquiries/Inquiries";
import { InquiryDetail } from "./pages/inquiries/InquiryDetail";
import { LegacyMessages } from "./pages/inquiries/LegacyMessages";
import { SignIn } from "./pages/SignIn";
import { EmptyState, PageHeader } from "./ui/parts";

const NAV = [
  { key: "dashboard", label: "ホーム", href: href.dashboard() },
  { key: "articles", label: "記事", href: href.articles() },
  { key: "media", label: "画像", href: href.media() },
  { key: "routes", label: "URL", href: href.routes() },
  { key: "inquiries", label: "お問い合わせ", href: href.inquiries() },
] as const;

type Auth = "checking" | "in" | "out";

export function App() {
  const route = useHashRoute();
  const [auth, setAuth] = useState<Auth>("checking");

  useEffect(() => {
    // With Access in front, an authorised browser is already signed in and
    // there is nothing to type. Probing beats asking.
    api.taxonomy().then(
      () => setAuth("in"),
      (error: unknown) => setAuth(error instanceof ApiError && error.status === 401 ? "out" : "in"),
    );
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setAuth("out");
  }, []);

  if (auth === "checking") return <div className="boot" aria-busy="true" />;
  if (auth === "out") return <SignIn onSignedIn={() => setAuth("in")} />;

  const current = section(route);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="管理メニュー">
        <a className="sidebar__brand" href={href.dashboard()}>
          Tomokichi Diary
          <small>Admin</small>
        </a>
        <ul>
          {NAV.map((item) => (
            <li key={item.key}>
              <a href={item.href} aria-current={current === item.key ? "page" : undefined}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="sidebar__foot">
          <a href="https://tomokichidiary.com/" target="_blank" rel="noopener noreferrer">
            サイトを開く ↗
          </a>
          {/* Only a stored token can be forgotten; Access sessions end at Access. */}
          {getToken() !== "" && (
            <button type="button" className="link" onClick={signOut}>
              サインアウト
            </button>
          )}
        </div>
      </nav>
      <main className="main">
        {route.name === "dashboard" && <Dashboard />}
        {route.name === "articles" && <Articles />}
        {route.name === "article" && <ArticleEditor key={route.id} id={route.id} />}
        {route.name === "media" && <MediaLibrary />}
        {route.name === "routes" && <Routes />}
        {route.name === "inquiries" && <Inquiries />}
        {route.name === "inquiry" && <InquiryDetail key={route.id} id={route.id} />}
        {route.name === "legacy-messages" && <LegacyMessages />}
        {route.name === "not-found" && (
          <>
            <PageHeader title="ページが見つかりません" />
            <EmptyState>
              <code>{route.path}</code> はありません。<a href={href.dashboard()}>ホームへ</a>
            </EmptyState>
          </>
        )}
      </main>
    </div>
  );
}
