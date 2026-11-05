/** Change only the managed opening; preserve the answer already written. */
export function replaceReplyOpening(body: string, previous: string, next: string): string {
  if (previous && body.startsWith(previous)) return next + body.slice(previous.length);
  const oldIdentity = previous.split("\n").at(-1) ?? "";
  const newIdentity = next.split("\n").at(-1) ?? "";
  return oldIdentity ? body.replace(oldIdentity, newIdentity) : body;
}
