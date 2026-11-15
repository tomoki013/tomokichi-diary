<div align="center">

# 🌏 ともきちの旅行日記

**Tomokichi Diary — Stories collected along the way.**

有名な観光地も、道端の小さな発見も。  
ガイドブックの外側にある「行ってみたら、こうだった」を残す旅行日記。

**[✈️ 旅に出る — tomokichidiary.com](https://tomokichidiary.com/)**

<sub>Sometimes the best part of a trip isn't on the itinerary.</sub>

</div>

---

### 🎫 YOUR BOARDING PASS

|               |                                    |
| :------------ | :--------------------------------- |
| **FLIGHT**    | TKD-002 · Tomokichi Diary 2.0      |
| **FROM**      | 好奇心                             |
| **TO**        | まだ見ぬ景色                       |
| **PASSENGER** | このREADMEを見つけたあなた         |
| **BOARDING**  | いつでも                           |
| **BAGGAGE**   | ちょっとの勇気と、たくさんの寄り道 |

> **旅の思い出は人間が書く。仕組みはなるべくシンプルに。**

## 🧭 What is this?

Tomokichi Diary is a travel publication built around firsthand stories, photographs, and the little moments that make a place memorable.

This repository is **Tomokichi Diary 2.0** — the engineering behind those stories.

Content, business rules, and URLs don't belong to any particular framework. **Astro, Hono, Cloudflare, D1, and R2 are adapters** around a plain-TypeScript core. The travel stories should outlive whichever framework happens to be fashionable this year.

## 🛫 Check in (development)

Your boarding procedure is pleasantly short:

```bash
pnpm install
pnpm run ci
```

`pnpm run ci` is the full preflight check: format, lint, types, boundaries, tests, build, route integrity, SEO integrity, internal links, and the Lighthouse budget.

It behaves the same locally and in CI. A successful flight prints one line; a failed one tells you **what broke, its stable error code, and how to rerun it**. No mysterious airport announcements.

## 🗺️ Route map (repository layout)

```text
                     ✈️ TOMOKICHI DIARY 2.0
                               │
           ┌───────────────────┴───────────────────┐
           │                                       │
      THE READERS                              THE EDITORS
           │                                       │
           ▼                                       ▼
      apps/web                                 apps/admin
      Astro · static                           Vite + React
      small scripts only                            │
           ▲                                       ▼
           │                                    apps/api
           │                              Hono · Cloudflare Workers
           │                                       │
           └──────────────┬────────────────────────┘
                          ▼
                     packages/
             framework-free TypeScript core
                          │
                          ▼
                   infrastructure/
                      D1 · R2
```

Also in `apps/`: `mcp-server` (public read-only MCP for AI agents, plus the private operator MCP that can do what the admin does) and `chagee` (the separate CHAGEE guide site, ADR 0010).

Other things packed in the suitcase:

| Path         | What's inside                                                                                                                       |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `export/`    | Snapshot of the content for local dev and code CI. Articles live in production D1; edit them in the admin or operator MCP, not here |
| `migration/` | Previous-site URLs and SEO, frozen. CI checks every old URL still resolves                                                          |
| `drafts/`    | Manuscripts waiting to be entered in the admin (not published from here)                                                            |
| `docs/`      | Architecture, editorial decisions, testing, security, and operations                                                                |

## 📖 Travel guide for developers

Every good trip needs a map. Every good repository needs documentation.

| Before you go…                      | Read this                                                                                   |
| :---------------------------------- | :------------------------------------------------------------------------------------------ |
| 🧱 Understand the architecture      | [Architecture](docs/ARCHITECTURE.md) — apps, packages, dependency direction, commands       |
| 🧩 Meet the entities                | [Data model](docs/DATA_MODEL.md) — entities and relationships                               |
| 📸 Pack the photographs             | [Photos](docs/MEDIA.md) — 保存先、管理画面での追加、本文への挿入、公開への反映              |
| ✍️ Tell the stories                 | [Editorial model](docs/EDITORIAL.md) — experience tags, home curation, story presentation   |
| 🛠️ Set up your equipment            | [Development](docs/DEVELOPMENT.md) — mise, environment, dev servers, troubleshooting        |
| 🧪 Run your preflight checks        | [Testing](docs/TESTING.md) — pure functions, built-site checks, critical areas              |
| 🔐 Keep your passport safe          | [Security](docs/SECURITY.md) — threat surface, secrets, data protection, logging            |
| 🚀 Prepare for departure            | [Release](docs/RELEASE.md) — branches, ordering, rollback                                   |
| 🧯 Handle unexpected detours        | [Operations](docs/OPERATIONS.md) — runbook keyed by stable error codes                      |
| 🧠 Remember why we chose this route | [Decisions](docs/DECISIONS.md) — ADR index ([docs/adr/](docs/adr/)) and code-only decisions |
| 🤖 Brief your AI copilot            | [AI instructions](docs/AI_INSTRUCTIONS.md) — coding-agent rules                             |
| 🗄️ Look back at finished work       | [Archive](docs/archive/) — the 2026-09 cutover audit and other finished-work records        |
| 🕳️ Find the gaps in the map         | [Test gap analysis](docs/testing/test-gap-analysis.md) — risks and coverage                 |

**管理画面で記事を保存・写真を挿入・自動公開する場合:** [docs/ADMIN.md](docs/ADMIN.md) を参照。

<details>
<summary>🧳 <strong>機内持ち込み手荷物を確認する（小さなイースターエッグ）</strong></summary>

<br>

```text
$ cat /旅の心得

01. 予定どおりに行かなくても、それはそれで旅。
02. 道に迷ったら、まず写真を撮る。
03. バグは直す。寄り道は残す。
04. いちばん面白い話は、だいたい帰国してから気づく。
```

**You've unlocked:** 何も起きません。ちょっと旅に出たくなるだけです。

</details>

---

<div align="center">

**Built for the stories. Not the other way around.**

[🌍 Read the diary](https://tomokichidiary.com/) · [⬆️ Back to the departure gate](#-ともきちの旅行日記)

<sub>旅は続く。READMEも、たぶん続く。</sub>

</div>
