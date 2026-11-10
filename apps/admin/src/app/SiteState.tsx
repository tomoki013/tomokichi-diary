import type { SitePublicationStatus } from "@tomokichi/contracts";
import { useOp } from "../data/hooks";
import { href } from "./router";

export const siteStateLabel = (status: SitePublicationStatus): string =>
  ({
    deployed: "サイト反映済み",
    queued: "反映待ち",
    building: "反映中",
    failed: "反映に失敗",
    unconfigured: "自動反映が未設定",
  })[status.state];

/** The site's one publication, always in view: every screen's writes end up there. */
export function SiteState() {
  const status = useOp("publication.status");
  const data = status.data;
  if (!data) return null;
  const tone =
    data.state === "failed" || data.state === "unconfigured"
      ? "failed"
      : data.state === "deployed"
        ? "ok"
        : "busy";
  return (
    <a className={`site-state site-state--${tone}`} href={href.site()}>
      {siteStateLabel(data)}
    </a>
  );
}
