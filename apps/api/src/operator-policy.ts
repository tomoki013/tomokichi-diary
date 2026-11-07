const READ_PATHS = [
  /^\/v1\/admin\/articles$/,
  /^\/v1\/admin\/articles\/[^/]+$/,
  /^\/v1\/admin\/articles\/[^/]+\/publish-check$/,
  /^\/v1\/admin\/articles\/body-audit$/,
  /^\/v1\/admin\/notes$/,
  /^\/v1\/admin\/notes\/[^/]+\/publish-check$/,
  /^\/v1\/admin\/publication$/,
  /^\/v1\/admin\/taxonomy$/,
  /^\/v1\/admin\/collections$/,
  /^\/v1\/admin\/media$/,
  /^\/v1\/admin\/monetization$/,
  /^\/v1\/admin\/monetization\/articles\/[^/]+$/,
  /^\/v1\/admin\/rankings$/,
];

const WRITE_PATHS: Record<string, RegExp[]> = {
  POST: [
    /^\/v1\/admin\/articles$/,
    /^\/v1\/admin\/articles\/[^/]+\/publish$/,
    /^\/v1\/admin\/collections$/,
    /^\/v1\/admin\/notes$/,
    /^\/v1\/admin\/notes\/[^/]+\/(?:publish|unpublish)$/,
    /^\/v1\/admin\/publication\/retry$/,
    /^\/v1\/admin\/rankings$/,
    /^\/v1\/admin\/tags$/,
    /^\/v1\/admin\/monetization\/experiments\/[^/]+\/(?:start|stop)$/,
  ],
  PUT: [
    /^\/v1\/admin\/articles\/[^/]+\/(?:draft|relations)$/,
    /^\/v1\/admin\/notes\/[^/]+\/(?:draft|related-articles)$/,
    /^\/v1\/admin\/monetization\/articles\/[^/]+$/,
    /^\/v1\/admin\/monetization\/experiments\/[^/]+$/,
  ],
  PATCH: [/^\/v1\/admin\/collections\/[^/]+$/, /^\/v1\/admin\/rankings\/[^/]+$/],
};

/** Endpoints the read/write Operator MCP client actually uses. */
export function isAllowedOperatorRequest(request: Request, allowWrites: boolean): boolean {
  const { pathname } = new URL(request.url);
  if (request.method === "GET") return READ_PATHS.some((pattern) => pattern.test(pathname));
  if (!allowWrites || request.method === "DELETE") return false;
  return (WRITE_PATHS[request.method] ?? []).some((pattern) => pattern.test(pathname));
}
