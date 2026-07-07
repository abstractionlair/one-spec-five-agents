# Build: Gemini

**Important framing:** The shared spec is not a prose brief — each of the 9 numbered specs ships a **complete, copy-pasteable reference implementation**. So "did it match the spec" is largely "did it faithfully transcribe the reference, and where it diverged, did it improve or degrade?" Gemini's build is ~90% verbatim reference code, assembled correctly, plus a handful of genuine, thoughtful edits. The assessment below focuses on the divergences, since that is where signal lives.

Verification note: this sandbox has **no C toolchain (make/gcc/g++ absent) and no network**, so `better-sqlite3` could not compile and the Node test suites could not execute here. I validated the two highest-risk, most-diverged pieces independently: the FTS5 schema + search SQL via Python's `sqlite3`, and the YAML/markdown writer->reader round-trip via pure-JS Node. Both pass.

---

## 1. Scope & completeness vs the 9 specs

| Spec | Status | Evidence |
|------|--------|----------|
| 01 project-setup/schema | **DONE** | `server/db/schema.sql` (verbatim, all 7 tables + FTS5), `migrations.js`, `projects.js`, `config.js`, `test-schema.js`. Schema validated: loads cleanly in sqlite 3.46, all 17 objects created. |
| 02 filesystem-storage | **DONE** | `files/storage.js`, `files/routes.js`, `utils/hash.js`, `utils/sanitize.js`, `test-file-apis.js`. `getProjectPath` extracted to `utils/paths.js` (see section 2). |
| 03 conversations-as-files | **DONE** | `conversations/writer.js` + `reader.js` + `routes.js`, `utils/yaml.js`, plus new `conversations/store.js`. Writer->reader round-trip validated: content + nested `usage` object recovered exactly. |
| 04 docker-execution | **DONE (code); unrun** | `execution/Dockerfile` (base bumped to `ubuntu:24.04`), `docker.js` (verbatim), `test-docker.js`, `tools.js`. No Docker here to exercise it. |
| 05 tool-integration | **DONE** | `server.js` `/api/turn` (verbatim), `adapters/openai.js`, `adapters/anthropic.js`, `execution/tools.js`, `test-turn.js`. **`adapters/google.js` absent** — but the *reference* also only implements openai+anthropic, so this matches the shipped reference, not the ROADMAP's aspiration. |
| 06 unified-search | **DONE** | `indexing/chunker.js`, `indexer.js`, `search.js`; auto-index wired into `storage.createFile/updateFile` and `writer.saveMessage`; search route in `server.js`; `test-search.js`. **Search SQL validated end-to-end** (below). |
| 07 system-prompts | **DONE** | `prompts/builder.js`, `prompts/templates.js`, `test-prompts.js`. templates.js rewritten (string-concat) and adds an empty-file-list fallback the reference lacked. |
| 08 ui-and-testing | **DONE** | `web/index.html`, `app.js`, `styles.css`, `server/test-e2e.js`. Adds `projects/routes.js` (reference omitted it — see section 6). No `QUICKSTART.md` (spec listed it as a deliverable). |
| 09 conversation-context-management | **MISSING** | No `context.js`, no `summarizer.js`, no `test-context.js`; no `/summarize` or `/stats` endpoints; `builder.js` uses the simple `slice(-MAX_HISTORY_MESSAGES)` window, not `getContextMessages`/`getSummary`. The `conversations.settings` column exists (groundwork) but the feature is unbuilt. |

**Net: 8/9 specs delivered; Steps 01-08 (the "core") are 100% present, Step 09 is 0%.**

## 2. Architecture choices & divergences from the reference

Storage/DB/search/execution all **FOLLOW** ARCHITECTURE.md exactly: better-sqlite3, hybrid metadata-in-DB / content-on-FS, markdown+YAML conversations, ephemeral `docker run --rm` with `-v project:/project:rw --memory 1g --cpus 2.0 --network`, single FTS5 `retrieval_index` with `porter unicode61` + bm25 + snippet. No architectural deviation.

Deliberate, **positive** divergences (Gemini's own work):
- **`utils/paths.js`** — extracts `getProjectPath`/`PROJECTS_ROOT` into a leaf module. The reference put `getProjectPath` in `files/storage.js`, creating a `storage -> indexer -> reader` / `writer -> storage` require cycle. Extracting it cleanly breaks that cycle. Thoughtful, correct.
- **`conversations/store.js`** — splits the DB-record layer (create/insert/list) out of `writer.js`, which now handles only markdown + orchestration. Reasonable separation of concerns; `writer.js` still re-exports the same surface so all callers/tests keep working.
- **`projects/routes.js`** — a REST layer for `/api/projects` (list/create/get/update/delete). The reference `server.js` never defined these, yet `web/app.js` calls `GET`/`POST /api/projects`. Without this addition the UI's project create/select would be dead. Necessary catch.
- **Dependency modernization** — `openai ^6.9.1`, `@anthropic-ai/sdk ^0.70.0`, `better-sqlite3 ^12.4.6` (reference pinned much older). The adapters still use `chat.completions.create` / `messages.create`, which remain API-compatible with these majors, so this is a safe, current-looking upgrade.

Provider adapters, chunker, indexer, search, docker executor, prompt builder: **verbatim** transcriptions of the reference.

## 3. Code quality

Structure is clean and idiomatic (it inherits the reference's shape and improves module boundaries). Error handling is consistent: routes wrap in try/catch -> 500 + `{error}`; indexing failures are caught and logged non-fatally in `createFile`/`saveMessage`. All **34 JS files parse cleanly** (`node --check`).

Real issues found (file:line):
- **`server/adapters/*` + missing dotenv wiring — highest-impact defect.** `package.json:16` declares `dotenv` but **nothing ever calls `require('dotenv').config()`** (grep: zero references). `adapters/openai.js:4` / `anthropic.js:4` read `process.env.*_API_KEY` at module load. A user who follows the README literally (`cp .env.example .env`, add keys, `npm start`) gets keys that are **never loaded** -> every model call fails. Adding dotenv to deps signals intent; the one wiring line is missing.
- **No migration on startup.** `server/server.js` / `db/index.js` never call `runMigrations()` (only the test scripts do). On a fresh checkout with no `storage/data.db`, the server boots but the first DB-touching request throws `no such table: projects`. It only works here because the build **ships a pre-migrated `storage/data.db`** (1 project, 1 conversation) — which also contradicts the README's claim that `storage/` is gitignored, and there is no `.gitignore`. Inherited from the reference, but not fixed.
- **Unused dependencies:** `cors` (`package.json:17`) is declared but never imported (no CORS middleware anywhere); `dotenv` as above. Cruft.
- **Dead exports:** `indexer.js:182 reindexProject` and `chunker.js:70 chunkText` are exported but never called (also true in the reference).
- **`writer.js:45-47`** builds the markdown via an awkward multi-line template-literal-with-embedded-newlines instead of the reference's `\n`-explicit string. **Verified functionally identical** — produces `---\n<yaml>\n---\n\n<body>` and round-trips through `reader.parseMarkdown`. Stylistic only.
- Naive YAML parser (inherited): fine for the controlled frontmatter, would mis-handle values with special chars — but that's a spec-level design choice, not a Gemini regression.

Tests: 8 suites present (`test-schema`, `test-file-apis`, `test-conversations`, `test-search`, `test-prompts`, `test-docker`, `test-turn`, `test-e2e`) totaling ~1,050 LOC — verbatim from the reference, and still consistent with the store.js refactor (they require from `./conversations/writer`, which re-exports everything). Could not execute in-sandbox (no `better-sqlite3` binary; no toolchain to build it).

**Independent validation of the risky logic (ran successfully):**
- Applied `schema.sql` in Python `sqlite3`, replayed the exact `search()` SQL from `indexing/search.js`: query `"authentication"` returned both a file and a conversation chunk; porter stemming matched `authentication`->`authenticate`; `snippet()` produced `<mark>`-highlighted output; `"token"` returned results from both source types. **Search + schema are correct.**
- Reproduced `writer.saveMessage`'s markdown construction and parsed it back with `reader.parseMarkdown` + `utils/yaml`: body matches, nested `usage:{input_tokens,output_tokens}` recovered, `speaker: agent:gpt-4o` colon-in-value preserved. **Conversation persistence is correct.**

## 4. Runnability

Disk OK (3.8G free). `npm install` succeeded (136 pkgs). The blocker to a live boot here is purely environmental: **`better-sqlite3` has no prebuilt binary for this node/platform and cannot compile** (make/gcc/g++ all absent, no network) — not a build defect.

Closeness to running on a normal machine: **partial-to-good.** Entry point `npm start` -> `server/server.js` is correct; static UI served from `web/`. It would run given (a) Docker running with the `multimodelchat-executor` image built, and (b) API keys **exported into the environment** (not just placed in `.env`, due to the missing dotenv wiring). The shipped pre-migrated `data.db` means it even sidesteps the missing-migration problem on this exact checkout. Docker not required for the non-execution paths (projects, files, conversations, search, UI).

## 5. Self-report accuracy

**No self-report to check.** There is no completion doc, changelog, status file, or `QUICKSTART.md` — only the standard project docs (VISION/ARCHITECTURE/ROADMAP/specs, unchanged from the spec) and a lightly-edited `README.md`. The README's claims are accurate except one: it states `storage/` is "gitignored," yet the build ships `storage/data.db` and includes no `.gitignore`. No inflated completion claims were made.

## 6. Standouts

**Done notably well:**
- **Caught a UI bug the reference shipped.** `web/app.js` reference relied on the non-standard global `event` inside `selectConversation`; Gemini threads the click event explicitly (`div.addEventListener('click', (e) => selectConversation(conv.id, e))` + `if (event) event.target...`). It also uses a real dated model id `claude-sonnet-4-5-20250929` instead of the reference's bare `claude-sonnet-4-5`.
- **Filled a genuine gap in the reference** by adding `projects/routes.js`; without it the UI's project management is non-functional.
- **Cleaner module graph** (`utils/paths.js`, `conversations/store.js`) that resolves the reference's circular requires, plus an empty-project fallback in `templates.js` (`(No files in project)`).

**Done notably poorly:**
- **Step 09 entirely skipped** — the one spec requiring real net-new logic (token estimation, summarization, context truncation, 2 endpoints) is absent. Conspicuous that the missing spec is also the least copy-pasteable one.
- **The dotenv trap** — adding `dotenv` to dependencies but never invoking it produces a build that silently ignores `.env`, breaking the documented setup flow. A half-finished touch is worse than leaving it as the reference had it.
- **Inert cruft** shipped (`cors` + `dotenv` unused deps) and the reference's migration-on-startup weakness left unaddressed while depending on a committed DB to paper over it.

## 7. Scorecard

- **LOC:** ~3,711 JS (server+web), of which ~2,659 non-test and ~1,052 tests; +~400 for HTML/CSS/schema/Dockerfile. ~4,100 total.
- **Source files:** 26 non-test JS modules (+8 test files).
- **Phase-1 spec delivered:** ~**90%** — Steps 01-08 complete and (for the verifiable slices) correct; Step 09 missing.
- **One-line characterization:** A faithful, correctly-assembled transcription of the reference implementations that adds a few genuinely smart fixes (UI event bug, missing project routes, decoupled modules) but skips the only spec demanding original logic (09) and introduces one real footgun (declared-but-unwired dotenv) — high fidelity, modest independent engineering.
