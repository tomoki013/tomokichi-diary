import { useEffect, useState, type ReactNode } from "react";
import { useRoute, sectionOf, href, type Route, type Section } from "./router";
import { SignIn } from "./SignIn";
import { SiteState } from "./SiteState";
import { Home } from "../features/home/Home";
import { ArticleList } from "../features/articles/ArticleList";
import { ArticleEditor } from "../features/articles/ArticleEditor";
import { NewArticle } from "../features/articles/NewArticle";
import { NoteList } from "../features/notes/NoteList";
import { NoteEditor } from "../features/notes/NoteEditor";
import { MediaLibrary } from "../features/media/MediaLibrary";
import { SeriesList, SeriesEdit } from "../features/curation/Series";
import { RankingList, RankingEdit } from "../features/curation/Rankings";
import { Ads } from "../features/ads/Ads";
import { KnowledgeReview } from "../features/knowledge/KnowledgeReview";
import { Analytics } from "../features/analytics/Analytics";
import { Inbox } from "../features/inquiries/Inbox";
import { Ticket } from "../features/inquiries/Ticket";
import { InquirySettings } from "../features/inquiries/InquirySettings";
import { SitePublication } from "../features/settings/SitePublication";
import { Connections } from "../features/settings/Connections";
import { Activity } from "../features/settings/Activity";
import { More } from "../features/settings/More";
import { Page, Empty } from "../ui/parts";

const NAV: { section: Section; label: string; href: string }[] = [
  { section: "home", label: "ホーム", href: href.home() },
  { section: "articles", label: "記事", href: href.articles() },
  { section: "notes", label: "日記", href: href.notes() },
  { section: "media", label: "写真", href: href.media() },
  { section: "more", label: "その他", href: href.more() },
];

function screen(route: Route): ReactNode {
  switch (route.name) {
    case "home":
      return <Home />;
    case "articles":
      return <ArticleList filter={route.filter} />;
    case "article":
      return <ArticleEditor key={route.id} id={route.id} />;
    case "new-article":
      return <NewArticle kind={route.kind} />;
    case "notes":
      return <NoteList />;
    case "note":
      return <NoteEditor key={route.id} id={route.id} />;
    case "media":
      return <MediaLibrary />;
    case "series":
      return <SeriesList />;
    case "series-edit":
      return <SeriesEdit key={route.id} id={route.id} />;
    case "rankings":
      return <RankingList />;
    case "ranking":
      return <RankingEdit key={route.id} id={route.id} />;
    case "ads":
      return <Ads />;
    case "knowledge":
      return <KnowledgeReview />;
    case "analytics":
      return <Analytics />;
    case "inquiries":
      return <Inbox />;
    case "inquiry":
      return <Ticket key={route.id} id={route.id} />;
    case "inquiry-settings":
      return <InquirySettings />;
    case "site":
      return <SitePublication />;
    case "connections":
      return <Connections />;
    case "activity":
      return <Activity targetType={route.targetType} targetId={route.targetId} />;
    case "more":
      return <More />;
    case "not-found":
      return (
        <Page title="見つかりません" back={{ href: href.home(), label: "ホーム" }}>
          <Empty>{route.path} という画面はありません。</Empty>
        </Page>
      );
  }
}

export function App() {
  const route = useRoute();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const onExpired = () => setExpired(true);
    globalThis.addEventListener("admin-session-expired", onExpired);
    return () => globalThis.removeEventListener("admin-session-expired", onExpired);
  }, []);
  if (expired) return <SignIn onSignedIn={() => setExpired(false)} />;
  const section = sectionOf(route);
  return (
    <div className="shell">
      <header className="topbar">
        <a className="topbar__brand" href={href.home()}>
          Diary Admin
        </a>
        <span className="topbar__site">
          <SiteState />
        </span>
      </header>
      <nav className="nav" aria-label="メニュー">
        {NAV.map((item) => (
          <a
            key={item.section}
            href={item.href}
            aria-current={item.section === section ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main className="main">{screen(route)}</main>
    </div>
  );
}
