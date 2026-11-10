"""Rewrites old `request("/v1/admin/...", {method, body})` test calls into `op("name", input)`."""
import re, sys, urllib.parse

ROUTES = [
 # method, regex, op, params, wrap
 ("GET", r"/articles", "article.list", [], None),
 ("POST", r"/articles", "article.create", [], None),
 ("GET", r"/articles/body-audit", "article.bodyAudit", [], None),
 ("GET", r"/articles/([^/]+)", "article.get", ["articleId"], None),
 ("PUT", r"/articles/([^/]+)/draft", "article.saveDraft", ["articleId"], None),
 ("GET", r"/articles/([^/]+)/publish-check", "article.publishCheck", ["articleId"], None),
 ("POST", r"/articles/([^/]+)/publish", "article.publish", ["articleId"], None),
 ("POST", r"/articles/([^/]+)/unpublish", "article.unpublish", ["articleId"], None),
 ("POST", r"/articles/([^/]+)/archive", "article.archive", ["articleId"], None),
 ("POST", r"/articles/([^/]+)/schedule", "article.schedule", ["articleId"], None),
 ("PUT", r"/articles/([^/]+)/relations", "article.setRelations", ["articleId"], None),
 ("PUT", r"/articles/([^/]+)/experience-tags", "article.setExperienceTags", ["articleId"], None),
 ("GET", r"/notes", "note.list", [], None),
 ("POST", r"/notes", "note.create", [], None),
 ("PUT", r"/notes/([^/]+)/draft", "note.saveDraft", ["noteId"], None),
 ("GET", r"/notes/([^/]+)/publish-check", "note.publishCheck", ["noteId"], None),
 ("POST", r"/notes/([^/]+)/publish", "note.publish", ["noteId"], None),
 ("POST", r"/notes/([^/]+)/unpublish", "note.unpublish", ["noteId"], None),
 ("PUT", r"/notes/([^/]+)/date", "note.setDate", ["noteId"], None),
 ("PUT", r"/notes/([^/]+)/related-articles", "note.setRelatedArticles", ["noteId"], None),
 ("DELETE", r"/notes/([^/]+)", "note.delete", ["noteId"], None),
 ("GET", r"/collections", "series.list", [], None),
 ("GET", r"/collections/([^/]+)", "series.get", ["collectionId"], None),
 ("POST", r"/collections", "series.create", [], None),
 ("PATCH", r"/collections/([^/]+)", "series.update", ["collectionId"], None),
 ("POST", r"/tags", "tag.create", [], None),
 ("GET", r"/taxonomy", "taxonomy.get", [], None),
 ("GET", r"/locations", "location.list", [], None),
 ("GET", r"/places", "place.list", [], None),
 ("GET", r"/rankings", "ranking.list", [], None),
 ("GET", r"/rankings/([^/]+)", "ranking.get", ["rankingId"], None),
 ("POST", r"/rankings", "ranking.create", [], None),
 ("PATCH", r"/rankings/([^/]+)", "ranking.update", ["rankingId"], None),
 ("GET", r"/media", "media.list", [], None),
 ("GET", r"/media/hash-status", "media.hashStatus", [], None),
 ("POST", r"/media/lookup", "media.lookup", [], None),
 ("PATCH", r"/media/([^/]+)", "media.update", ["mediaId"], None),
 ("PUT", r"/media/article/([^/]+)", "article.setMedia", ["articleId"], None),
 ("GET", r"/knowledge/article/([^/]+)", "knowledge.get", ["articleId"], None),
 ("PUT", r"/knowledge/article/([^/]+)", "knowledge.save", ["articleId"], "bundle"),
 ("GET", r"/monetization", "ads.overview", [], None),
 ("PUT", r"/monetization/settings", "ads.saveSettings", [], "settings"),
 ("GET", r"/monetization/articles/([^/]+)", "ads.article", ["articleId"], None),
 ("PUT", r"/monetization/articles/([^/]+)", "ads.saveArticle", ["articleId"], "config"),
 ("GET", r"/monetization/articles/([^/]+)/validate", "ads.validateArticle", ["articleId"], None),
 ("POST", r"/monetization/offers", "offer.create", [], "offer"),
 ("PUT", r"/monetization/offers/([^/]+)", "offer.update", [None], "offer"),
 ("DELETE", r"/monetization/offers/([^/]+)", "offer.archive", ["offerId"], None),
 ("PUT", r"/monetization/experiments/([^/]+)", "ads.saveExperiment", [None], "experiment"),
 ("POST", r"/monetization/experiments/([^/]+)/(start|stop)", "ads.controlExperiment", ["experimentId", "action"], None),
 ("GET", r"/publication", "publication.status", [], None),
 ("POST", r"/publication/retry", "publication.run", [], None),
 ("GET", r"/likes", "like.activity", [], None),
 ("GET", r"/analytics", "analytics.dashboard", [], None),
 ("GET", r"/analytics/reports", "analytics.savedReports", [], None),
 ("GET", r"/activity", "activity.list", [], None),
 ("GET", r"/connections", "connection.list", [], None),
 ("POST", r"/connections/clients/([^/]+)/label", "connection.label", ["clientId"], None),
 ("POST", r"/connections/([^/]+)/([^/]+)/revoke", "connection.revoke", ["issuer", "grantId"], None),
 ("GET", r"/inquiry/status", "inquiry.status", [], None),
 ("GET", r"/inquiry/signature", "inquiry.signature", [], None),
 ("PUT", r"/inquiry/signature", "inquiry.saveSignature", [], None),
 ("GET", r"/inquiry/templates", "inquiry.templates", [], None),
 ("POST", r"/inquiry/templates", "inquiry.createTemplate", [], None),
 ("PATCH", r"/inquiry/templates/([^/]+)", "inquiry.updateTemplate", ["templateId"], None),
 ("GET", r"/inquiry/tickets", "inquiry.tickets", [], None),
 ("GET", r"/inquiry/tickets/([^/]+)", "inquiry.ticket", ["ticketId"], None),
 ("PATCH", r"/inquiry/tickets/([^/]+)", "inquiry.changeTicket", ["ticketId"], None),
 ("POST", r"/inquiry/tickets/([^/]+)/notes", "inquiry.addNote", ["ticketId"], None),
 ("GET", r"/inquiry/tickets/([^/]+)/compose", "inquiry.compose", ["ticketId"], None),
 ("POST", r"/inquiry/tickets/([^/]+)/apply-template", "inquiry.applyTemplate", ["ticketId"], None),
 ("POST", r"/inquiry/tickets/([^/]+)/reply", "inquiry.reply", ["ticketId"], None),
]
NUMERIC = {"offset", "limit", "page"}

def match_close(src, i):
    """index after the bracket matching src[i] (which is ( [ or {), skipping strings."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    stack = []
    n = len(src)
    while i < n:
        ch = src[i]
        if ch in "\"'`":
            q = ch; i += 1
            while i < n and src[i] != q:
                if src[i] == "\\": i += 1
                elif q == "`" and src[i:i+2] == "${":
                    i = match_close(src, i+1) - 1
                i += 1
        elif ch in pairs: stack.append(pairs[ch])
        elif stack and ch == stack[-1]:
            stack.pop()
            if not stack: return i + 1
        i += 1
    raise ValueError("unbalanced")

def split_args(text):
    args, depth, start, i = [], 0, 0, 0
    while i < len(text):
        ch = text[i]
        if ch in "\"'`":
            j = match_close("(" + text[i:] , 0) if False else None
            q = ch; i += 1
            while i < len(text) and text[i] != q:
                if text[i] == "\\": i += 1
                elif q == "`" and text[i:i+2] == "${":
                    i = match_close(text, i+1) - 1
                i += 1
        elif ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        elif ch == "," and depth == 0:
            args.append(text[start:i].strip()); start = i + 1
        i += 1
    last = text[start:].strip()
    if last: args.append(last)
    return args

def path_segments(lit):
    """Turn a "..." or `...${x}...` literal into (plain path with placeholders, {placeholder: expr})."""
    exprs = {}
    inner = lit[1:-1]
    if lit[0] == "`":
        out, i, k = "", 0, 0
        while i < len(inner):
            if inner[i:i+2] == "${":
                j = match_close(inner, i+1)
                key = f"\0{k}\0"; exprs[key] = inner[i+2:j-1].strip(); k += 1
                out += key; i = j
            else:
                out += inner[i]; i += 1
        inner = out
    return inner, exprs

def value_of(seg, exprs):
    if seg in exprs:
        e = exprs[seg]
        m = re.fullmatch(r"encodeURIComponent\((.*)\)", e)
        return m.group(1) if m else e
    for key, e in exprs.items():
        if key in seg:
            return "`" + "".join(("${" + exprs[p] + "}") if p in exprs else p for p in re.split("(\0\\d+\0)", seg)) + "`"
    return '"' + urllib.parse.unquote(seg) + '"'

def convert(call_args, prefix):
    lit = call_args[0]
    if lit[0] not in "\"`": return None
    path, exprs = path_segments(lit)
    path = prefix + path
    if not path.startswith("/v1/admin"): return None
    path = path[len("/v1/admin"):]
    query = ""
    if "?" in path: path, query = path.split("?", 1)
    init = call_args[1] if len(call_args) > 1 else "{}"
    m = re.search(r'method:\s*"(\w+)"', init)
    method = m.group(1) if m else "GET"
    body = None
    i = init.find("body:")
    if i >= 0:
        j = init.find("JSON.stringify(", i)
        if j < 0: return None
        k = j + len("JSON.stringify")
        body = init[k+1:match_close(init, k)-1].strip()
    for (mth, rx, op, params, wrap) in ROUTES:
        mm = re.fullmatch(rx, path)
        if mth != method or not mm: continue
        fields = []
        for name, seg in zip(params, mm.groups()):
            if name: fields.append(f"{name}: {value_of(seg, exprs)}")
        for part in filter(None, query.split("&")):
            key, _, val = part.partition("=")
            if key == "q": key = "query"
            v = value_of(val, exprs)
            if key in NUMERIC and v.startswith('"'): v = v.strip('"')
            fields.append(f"{key}: {v}")
        if body is not None:
            if wrap: fields.append(f"{wrap}: {body}")
            elif body.startswith("{") and body.endswith("}"):
                inner = body[1:-1].strip().rstrip(",")
                if inner: fields.append(inner)
            else: fields.append(f"...{body}")
        rest = call_args[2:]
        headers = re.search(r"headers:\s*([^,}]+)", init)
        extra = ""
        if rest: extra = ", " + ", ".join(rest)
        inp = "{ " + ", ".join(fields) + " }" if fields else ("{}" if rest else "")
        return f'op("{op}"' + (f", {inp}" if inp else "") + extra + ")", (headers.group(1).strip() if headers else None)
    return None

def run(file, fn, prefix):
    src = open(file).read()
    out, i, changed, skipped = "", 0, 0, []
    pat = re.compile(r"(?<![\w.])" + re.escape(fn) + r"\(")
    while True:
        m = pat.search(src, i)
        if not m: out += src[i:]; break
        start = m.start(); open_i = m.end() - 1
        end = match_close(src, open_i)
        args = split_args(src[open_i+1:end-1])
        res = None
        try: res = convert(args, prefix) if args else None
        except Exception as e: res = None
        if res:
            out += src[i:start] + res[0]; changed += 1
        else:
            out += src[i:end]
            skipped.append(src[start:min(end, start+90)].replace("\n", " "))
        i = end
    open(file, "w").write(out)
    print(file, "converted", changed, "left", len(skipped))
    for s in skipped: print("   LEFT:", s)

if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
