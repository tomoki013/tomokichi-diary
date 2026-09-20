/**
 * The SEO-relevant parts of one built page, read back out of its HTML.
 *
 * Pure functions, so the extraction and the rules that judge it can be tested
 * without a `dist/` — `check-seo.ts` wires them to the built site.
 */
export interface PageSeo {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  jsonLd: string[];
  imagesWithoutAlt: number;
  /** Every social/preview image URL the page declares: og:image, twitter:image. */
  socialImages: string[];
}

export function readSeo(html: string): PageSeo {
  const value = (pattern: RegExp): string | null => pattern.exec(html)?.[1]?.trim() ?? null;
  const all = (pattern: RegExp): string[] =>
    [...html.matchAll(pattern)].map((m) => m[1]!.trim()).filter((v) => v !== "");
  return {
    title: value(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: value(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i),
    canonical: value(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i),
    robots: value(/<meta[^>]+name="robots"[^>]+content="([^"]*)"/i),
    h1Count: [...html.matchAll(/<h1[\s>]/gi)].length,
    jsonLd: [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(
      (m) => m[1]!,
    ),
    // `<img alt>` is the valid, minimised spelling of `alt=""`, which is what
    // a deliberately decorative image renders as.
    imagesWithoutAlt: [...html.matchAll(/<img\b[^>]*>/gi)].filter(
      (m) => !/\salt(?:=|\s|>)/i.test(m[0]),
    ).length,
    socialImages: [
      ...all(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/gi),
      ...all(/<meta[^>]+name="twitter:image"[^>]+content="([^"]*)"/gi),
    ],
  };
}

/**
 * Image URLs that JSON-LD declares on Article/BlogPosting nodes, flattened.
 * Any node that fails to parse is skipped here; `SEO_JSONLD_INVALID` reports it.
 */
export function jsonLdImageUrls(blocks: readonly string[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    let node: unknown;
    try {
      node = JSON.parse(block);
    } catch {
      continue;
    }
    const nodes = Array.isArray(node) ? node : [node];
    for (const item of nodes) {
      if (typeof item !== "object" || item === null) continue;
      const image = (item as { image?: unknown }).image;
      if (typeof image === "string") urls.push(image);
      else if (Array.isArray(image)) {
        for (const entry of image) {
          if (typeof entry === "string") urls.push(entry);
          else if (typeof entry === "object" && entry !== null) {
            const url = (entry as { url?: unknown }).url;
            if (typeof url === "string") urls.push(url);
          }
        }
      }
    }
  }
  return urls;
}

/**
 * Why a preview image URL is unusable, or `null` when it is fine.
 *
 * Crawlers and social cards need one absolute `http(s)` URL. The failure this
 * was written for was a media URL that had already been made absolute being
 * prefixed with the site origin a second time, which produced
 * `https://site/https://media/...` — syntactically a URL, so nothing threw,
 * and every share card on the site was blank.
 */
export function imageUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not an absolute URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `unsupported scheme ${parsed.protocol}`;
  }
  // A second scheme inside the path is the double-prefix bug, whatever the
  // host: `/https://`, `/http://`, or their escaped forms.
  if (/\/(?:https?:\/\/|https?%3A)/i.test(parsed.pathname + parsed.search)) {
    return "contains a nested URL (origin prefixed twice)";
  }
  if (!/\.(?:avif|webp|jpe?g|png|gif|svg)$/i.test(parsed.pathname)) {
    return "does not end in an image extension";
  }
  return null;
}
