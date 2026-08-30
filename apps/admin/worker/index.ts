/**
 * The admin is served from a single hostname that also carries the API under
 * `/api/*`.
 *
 * That is what lets Cloudflare Access protect both with one application and
 * one cookie: the browser's calls to the API are same-origin, so the Access
 * cookie rides along without CORS or a token in the page. The API is reached
 * through a service binding, so the request never leaves Cloudflare's network.
 */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API: { fetch(request: Request): Promise<Response> };
}

const API_PREFIX = "/api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) return env.ASSETS.fetch(request);

    const forwarded = new URL(request.url);
    forwarded.pathname = url.pathname.slice(API_PREFIX.length);
    return env.API.fetch(new Request(forwarded, request));
  },
};
