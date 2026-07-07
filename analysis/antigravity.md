# Build: Antigravity

*Reviewer notes: verified by reading every source file, inspecting `storage/data.db`, examining runtime leftovers in `projects/`, and actually running the three non-Docker test suites (all pass). Docker itself is unavailable in this review environment, so spec 04 is judged by code + on-disk execution artifacts.*

**One-sentence verdict:** Antigravity built a clean, tested, genuinely-working *foundation* (DB + filesystem + conversations + Docker sandbox) and then stopped exactly where the actual product begins — there is no model adapter, no search, no prompt builder, no HTTP server, and no UI, so the system cannot do the one thing it exists to do: chat with a model.

---

## 1. Scope & completeness vs the 9 specs

| Spec | Status | Evidence |
|------|--------|----------|
| **01 – Project setup & SQLite schema** | **DONE** | `server/db/schema.sql` (all 6 tables + both FTS5 virtual tables), `db/index.js` (better-sqlite3, WAL, FK on), `db/migrations.js` (versioned), `db/projects.js` + `db/config.js` (full CRUD). `test-schema.js` **passes** (ran it). |
| **02 – Filesystem storage & file APIs** | **DONE (logic) / PARTIAL (API)** | `files/storage.js` create/read/list/update/delete + hash change-detection; `utils/hash.js`, `utils/sanitize.js` (traversal guard). `test-file-apis.js` **passes** (ran it). Caveat: `files/routes.js` exists but is un-runnable — see below. |
| **03 – Conversations as files** | **DONE (logic) / PARTIAL (API)** | `conversations/writer.js` + `reader.js` write/parse markdown+YAML frontmatter into `.conversations/{id}/rounds/NNN-speaker.md`; `utils/yaml.js` hand-rolled parser. `test-conversations.js` **passes** (ran it). Same route caveat. |
| **04 – Docker execution** | **DONE** | `execution/Dockerfile` (ubuntu:24.04, python+node+pixi), `execution/docker.js` (`docker run --rm`, `-v :/project:rw`, mem/cpu/network/timeout limits, `--user UID:GID`), `test-docker.js` (13 cases: venv, pip, npm, timeout, network on/off). Couldn't run Docker here, but `projects/proj_*/files/{test-output.txt, package.json, .npm-cache}` are real host-visible artifacts left by executed containers — it demonstrably ran. |
| **05 – Tool integration in /api/turn** | **MISSING** | No `server/adapters/` (no openai.js/anthropic.js/google.js), no `execution/tools.js`, no `server.js`, no `/api/turn`. `package.json` has **no** LLM SDK and **no** express. This is the core product feature and it is absent. |
| **06 – Unified search (FTS5)** | **MISSING (schema-only)** | Tables `content_chunks` + `retrieval_index` exist and are created (confirmed in `data.db`), but there is **no** `indexing/chunker.js`, `indexer.js`, or `search.js`. Nothing ever writes a chunk (`content_chunks` row count = 0) and nothing queries FTS5. |
| **07 – System prompts & context** | **MISSING** | No `server/prompts/` directory at all. |
| **08 – UI & testing** | **MISSING (UI) / PARTIAL (testing)** | No `web/` directory, no `index.html`/`app.js`, no e2e test. Per-module test scripts exist and pass, but there is no end-to-end test because there is no end to end. |
| **09 – Conversation context management** | **MISSING** | No `conversations/context.js` or `summarizer.js`; `conversations.settings` column exists (for future summaries) but is unused. |

**Net:** 4 of 9 specs delivered (01–04). Specs 05–09 — every piece that turns the storage layer into a usable multi-model chat app — are absent.

---

## 2. Architecture choices & divergences from the reference

- **SQLite library:** `better-sqlite3@^12.4.6` — exactly the reference choice (ARCHITECTURE.md line 36). Synchronous API used idiomatically with prepared statements. WAL + `foreign_keys=ON` set. **Follows.**
- **Storage layout:** `projects/{id}/files/…`, conversations under `.conversations/{conv}/rounds/NNN-speaker.md`, `storage/data.db`. Matches the reference directory tree almost exactly. **Follows.**
- **Schema:** Faithful to ARCHITECTURE.md, with two deliberate *additions*: a `description` column on `projects`, a `settings` JSON column on `conversations` (forward-looking, for spec-09 summaries), and an **extra external-content FTS5 table `project_files_path_fts`** for filename search — a thoughtful bonus not in the reference. **Follows + sensible extension.**
- **Docker execution:** `docker run --rm` ephemeral model, project mounted rw, resource/network/timeout limits — matches the reference precisely. Two divergences: `ubuntu:24.04` instead of the spec's `22.04` (fine, newer), and a genuinely good `--user ${UID}:${GID}` addition to avoid root-owned files on the host (spec didn't ask for it). Default timeout raised 60s→120s. **Follows + improves.**
- **FTS5 search:** Divergence-by-omission. Schema is present and correct; the *implementation* pillar is missing entirely.
- **Provider adapters:** **Missing.** The reference's central abstraction (provider-agnostic OpenAI/Anthropic/Google adapters with a tool-calling loop) was never started.
- **UI / server:** **Missing.** ARCHITECTURE.md's top-of-DAG "Express Server + Browser" does not exist. Express is not even a dependency, so the two `routes.js` files that *do* exist cannot be mounted.

**Character of the divergences:** Where Antigravity built something, it followed the reference closely and even improved it in two spots (`--user`, path-FTS). The divergences that matter are not design choices — they are the un-built top half of the stack (adapters, tool loop, search, prompts, server, UI).

---

## 3. Code quality

Quality of what exists is **high** — this is the build's strongest attribute.

- **Structure:** Clean module boundaries mirroring the reference (`db/`, `files/`, `conversations/`, `execution/`, `utils/`). Small, single-purpose files. Consistent CommonJS, consistent 4-space style, decent JSDoc comments.
- **Error handling:** Reasonable. Routes wrap handlers in try/catch with 4xx/5xx JSON; `deleteFile` swallows `ENOENT` but rethrows other errors (`files/storage.js:148-153`); path sanitizer rejects `..`/`~` and re-checks after `path.normalize` (`utils/sanitize.js`).
- **Tests present & run:** `test-schema.js`, `test-file-apis.js`, `test-conversations.js` — **all pass** when run (I ran them). `test-docker.js` is thorough (13 assertions) but needs a Docker daemon. Tests call the storage/db functions **directly**, which is why they pass despite the routes being un-runnable.
- **Bugs / weaknesses (all minor, in delivered code):**
  - **Dead HTTP layer:** `files/routes.js:1` and `conversations/routes.js:1` both `require('express')`, but express is not in `package.json` and nothing imports these routers. They would throw `Cannot find module 'express'` on load. Effectively unreachable code.
  - **Hand-rolled YAML is fragile** (`utils/yaml.js`): one nesting level only, no quoting/escaping, and `parseValue` coerces any `^\d+(\.\d+)?$` string to a number — a message body/title that is purely numeric would round-trip as a number. Fine for the current frontmatter shapes, brittle beyond them.
  - **npm cache leak:** Dockerfile sets `NPM_CONFIG_CACHE=/tmp/.npm-cache`, yet leftover `projects/*/files/.npm-cache/` on the host shows npm cache landing in the mounted project dir in at least one run — the env guard didn't take effect for those runs.
  - **`--user ${process.env.UID || 1000}`** (`docker.js:34`): `$UID` is a bash shell var, not exported to Node's env, so this almost always falls back to the `1000` literal. Works when the host user is uid 1000 (it is here), silently wrong otherwise.
  - **Migration split-on-`;`** (`migrations.js:39`) is naive but safe for this schema (no semicolons inside statements).
- **Dead/unused:** the two route files; `conversations.settings` and `projects.description` columns are written but never read by any feature.
- **Hardcoded values:** image name `multimodelchat-executor`, mem `1g`, cpus `2.0`, timeout `120000` — all sensibly defaulted and overridable via `options`.

---

## 4. Runnability

- **`npm install`:** ran it — succeeded (52 packages; prebuilt `better-sqlite3` binary; ~1s). *(The review sandbox globally sets `ignore-scripts=true`, which initially skipped the native-binary download; running the install script directly fixed it. On a normal machine `npm install` is clean.)*
- **What runs today:** The three storage-layer test scripts run and pass end-to-end (`node server/db/test-schema.js`, `node server/test-file-apis.js`, `node server/test-conversations.js`). The Docker suite would run given a daemon and one `docker build`.
- **What does NOT run:** There is **no application**. No `server.js`, no `npm start` (the `start` script is absent; `main` points at a non-existent `index.js`), no HTTP listener, no way to send a chat turn, no UI. `package.json` lacks express and every LLM SDK. You can exercise the libraries; you cannot run the product.
- **Distance to running:** Far. To reach even a single working `/api/turn` you'd need to add express + an adapter + the tool loop + a server entry point + wire the existing routers — i.e. essentially specs 05 and 07, plus a server. It is a library, not an app.

---

## 5. Self-report accuracy

There are **no build-authored completion/summary/progress docs** — no COMPLETION.md, SUMMARY.md, QUICKSTART.md, no README changes. The only `README.md` is the unmodified spec README (3,624 bytes, identical to the spec repo). `package.json`'s description optimistically claims "query multiple models … in parallel with shared context … and sandboxed code execution," which is **not true** of the delivered code (no querying, no models, no shared-context turn). But since Antigravity made no explicit progress claims, there is nothing to catch it lying about — it neither over- nor under-reports because it reports nothing. Honest by silence.

---

## 6. Standouts

**Notably well:**
1. **Everything it shipped actually works and is tested.** Three green test suites, real Docker execution artifacts on disk, a correct schema in a real `data.db`. No fabricated "done."
2. **Faithful, tasteful architecture.** Matches the reference layout and even improves two spots (`--user` UID mapping to prevent root-owned host files; an extra filename-search FTS5 table).
3. **Clean, readable, low-ceremony code** with sensible error handling and path-traversal defense.

**Notably poorly:**
1. **It never built the product.** No adapters, no `/api/turn`, no tool-calling loop — the multi-model chat that is the entire point (spec 05) is absent. This is the single biggest miss.
2. **No search, prompts, or UI** (specs 06/07/08): the FTS5 tables sit empty because nothing indexes or queries them; there is no way for a human to use the system.
3. **A visible seam:** two `express` route files with no express dependency and no server to mount them — started the HTTP layer, then abandoned it, leaving un-loadable dead code.

---

## 7. Scorecard

- **LOC:** ~1,840 lines of hand-written code (≈1,300 non-test source incl. Dockerfile; ≈535 test) + generated `package-lock.json`.
- **Source files:** 20 authored files — 14 `.js` source + 1 `schema.sql` + 1 Dockerfile + 4 test scripts (no UI, no adapters, no server entry).
- **Rough % of Phase-1 spec delivered:** **~40%.** Specs 01–04 fully done (≈11–15h of the roadmap's 26–36h). Specs 05–09 essentially 0% (schema for 06 exists but no code). Weighted for *user-facing* capability it's closer to **0%** — the app cannot be started or chatted with.
- **One-line characterization:** A rock-solid, well-tested foundation — DB, filesystem, conversations, and a real Docker sandbox — that halts precisely at the waterline of the actual product: no models, no search, no prompts, no server, no UI. Excellent bricks, no house.
