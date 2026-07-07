# Build: Claude Code (Sonnet 4.5)

Analyzed at `~/staging/from-zip/multi-model-chat-claude-code-sonnet45/`. Verified against the shared spec in `~/staging/from-zip/multi-model-chat/` (VISION, ARCHITECTURE, ROADMAP, specs 01-09). All claims below were checked against source; `npm install` was run and the app's own `server.log` (from the origin macOS run) was inspected.

Total source: ~3,347 LOC across ~33 code files (server + web), plus a real SQLite DB and sample conversation data indicating the system was actually run.

---

## 1. Scope & completeness vs the 9 specs

| Spec | Status | Evidence |
|------|--------|----------|
| 01 project-setup & schema | **DONE** | `server/db/schema.sql` has all 6 tables + FTS5 `retrieval_index` (porter unicode61); `migrations.js` versioned migration; `projects.js`/`config.js` CRUD. Schema matches ARCHITECTURE (adds harmless `projects.description`, `conversations.settings`). |
| 02 filesystem-storage | **DONE** | `files/storage.js`: content on FS at `projects/{id}/files/{path}`, SHA256 `utils/hash.js`, `utils/sanitize.js` blocks traversal, upsert + `hasFileChanged`. Full REST in `files/routes.js` (JSON + multipart). |
| 03 conversations-as-files | **DONE** | `conversations/writer.js` writes `---`+YAML+body markdown to `.conversations/{conv}/rounds/{NNN}-{speaker}.md`; `reader.js` parses back. Confirmed by real saved file `001-agent-gpt-4o.md` with correct frontmatter (id/speaker/round/timestamp/model/provider/usage). |
| 04 docker-execution | **DONE** | `execution/docker.js` spawns `docker run --rm -v {proj}:/project:rw -w /project --memory 1g --cpus 2.0 --network bridge`, SIGTERM timeout (60s). `Dockerfile` = ubuntu22 + python3/venv + node/npm + pixi + build-essential. Gap: per-project `allow_network`/`additional_volumes` from settings are never passed through. |
| 05 tool-integration `/api/turn` | **DONE** | `routes/turn.js` + 3 adapters (`openai`/`anthropic`/`google`), each with a 10-iteration tool-calling loop and shared `bash` tool (`execution/tools.js`). Parallel models via `Promise.all`; per-model error isolation. Latent bug in multi-model history (see section 3). |
| 06 unified-search (FTS5) | **PARTIAL** | `indexing/{chunker,indexer,search}.js` all exist and search endpoint is mounted, BUT `indexer.js` is **never imported anywhere** (grep confirms) - neither `createFile` nor `saveMessage` nor `/api/turn` index anything. So the FTS5 table stays empty in real use and search returns nothing. Auto-indexing (an explicit step-06 deliverable) is absent; no search test exists. |
| 07 system-prompts | **DONE** | `prompts/builder.js` builds a rich prompt (project name, file listing truncated to 50, bash/venv/npm/pixi instructions, round context) and routes system-message placement per provider (`buildMessagesWithSystem`). Minor: single template, not the per-provider `templates.js` the roadmap sketches. |
| 08 ui-and-testing | **PARTIAL** | `web/` is a working 3-pane chat (project select, conversation list, multi-model checkboxes, send). BUT **no file-upload UI and no search UI** (both named step-08 deliverables), and the `test-e2e.js` script referenced in `package.json` does not exist. |
| 09 conversation-context-management | **MISSING** | No summarization / token-threshold / context-compaction code. `IMPLEMENTATION_COMPLETE.md` explicitly lists it as not implemented. History is a naive "last 10 messages" slice in `turn.js`. |

Tally: 6 DONE, 2 PARTIAL, 1 MISSING -> ~75% of the 9-spec scope.

---

## 2. Architecture choices & divergences from the reference

Almost entirely **FOLLOW** - this build tracks ARCHITECTURE.md closely, often file-for-file:

- **SQLite library:** `better-sqlite3` (exactly as specified), WAL + `foreign_keys=ON` in `db/index.js`. FOLLOW.
- **Storage layout:** metadata-in-DB / content-on-FS split, `projects/{id}/files/...`, `.conversations/{conv}/rounds/*.md`, `storage/data.db`. Matches the reference tree. FOLLOW.
- **Docker execution:** ephemeral `docker run --rm`, project mounted rw, memory/cpu/network/timeout flags - matches the reference invocation verbatim. FOLLOW.
- **FTS5 search:** `retrieval_index` virtual table with `bm25()` ranking + `snippet()` highlighting, `content_chunks` sidecar, ~50-line chunking. Design FOLLOWS; the only divergence is a **shortcut** - the indexer is never wired into the write paths, so the design is present but inert.
- **Provider adapters:** OpenAI + Anthropic + Google (reference names all three), each with its own tool schema shape and tool-result plumbing. FOLLOW (slightly exceeds strict step-05 scope, which only required OpenAI + Anthropic).
- **UI:** static HTML/JS/CSS talking to REST, as specified. FOLLOW, but under-scoped (no upload/search surface).

Deliberate/acceptable divergences: extra `google.js` adapter (good), extra `projects.description` column (harmless). The one divergence that is a **shortcut, not an improvement** is the un-wired indexer.

---

## 3. Code quality

Generally clean, consistent, readable: small single-purpose modules, uniform `try/catch` -> `res.status(500)` in every route, JSDoc headers, parameterized SQL throughout (no injection surface), prepared statements. Naming/structure mirror the spec. For a ~3.3k-LOC build this is tidy.

Bugs / issues (file:line):

- **Search is dead on arrival.** `server/indexing/indexer.js` (`indexFile`/`indexMessage`) is never imported by any caller (verified by grep). `files/storage.js:createFile`, `conversations/writer.js:saveMessage`, and `routes/turn.js` all skip indexing. FTS5 stays empty -> `/api/projects/:id/search` returns `[]` in practice. Biggest functional gap.
- **Multi-model history breaks Anthropic on later rounds.** `routes/turn.js:29` maps every non-user speaker to role `assistant`. A round with N agents yields consecutive `assistant` messages; `adapters/anthropic.js` forwards them to `messages.create`, which requires strict user/assistant alternation -> 400 on round >=2 with multiple models. Single-model works (that's what actually ran).
- **`package.json` scripts reference missing files.** `test:turn` (`server/test-turn.js`), `test:search` (`server/test-search.js`), `test:e2e` (`server/test-e2e.js`) do not exist. `npm run test:all` chains through `test:search` and therefore **fails** with MODULE_NOT_FOUND (reproduced). Search and the end-to-end turn have zero automated tests.
- **Per-project Docker settings ignored.** `docker.js:executeBash` accepts `network`/`env`/volume options, but `tools.js:executeTool` calls it with only `(command, projectId)`, so `settings.allow_network` / `additional_volumes` (in schema + ARCHITECTURE) are never honored.
- **Dead code / minor:** `indexer.js` entirely unused; naive `utils/yaml.js` regex parser (one nesting level, would mangle multi-line values / special-char keys - fine for the fixed frontmatter shape but fragile); empty arrays render a trailing `tool_calls:` line in frontmatter (cosmetic).
- **Runtime errors captured in origin `server.log`:** `Create conversation error: FOREIGN KEY constraint failed` (UI posted a stale/missing `projectId`) and `google/gemini-2.0-flash-exp ... 404 Not Found` (hardcoded model id in `web/index.html:40` is invalid/stale). The OpenAI path completed cleanly.

Tests present: 4 hand-rolled integration scripts (`test-schema`, `test-file-apis`, `test-conversations`, `test-docker`) - no framework, but they exercise real CRUD/cascade/FS/round behavior and are reasonable smoke tests. Could not execute in this sandbox (section 4). Docker test needs Docker (absent). No tests for search, prompts, adapters, or `/api/turn`.

---

## 4. Runnability

Disk OK (3.8G free). `npm install` **succeeds** (155 packages, ~2s; only deprecation/audit warnings). Entry point clean: `npm start` -> `server/server.js` runs migrations then serves API + static `web/`.

Blocker in *this* sandbox only: `better-sqlite3` needs a native binary, and this environment has **no prebuild for the ABI and no C toolchain** (`make`/`g++`/`gcc` absent; `npm rebuild` no-ops). So every DB-touching path - all four tests and the server - fails to load `better-sqlite3` here. This is an environment limitation, **not an application-code defect**; `better-sqlite3` is the spec-endorsed library.

Strong evidence it runs elsewhere: shipped `server.log` (origin `/Volumes/Share 1/...` macOS run) shows migrations completing, `Database initialized`, server booting on port 3000, and a **real end-to-end OpenAI turn** - the saved `projects/.../001-agent-gpt-4o.md` (gpt-4o, 405 in / 16 out tokens) is the proof. So: **partial** runnable here (install works, native module can't build), demonstrably runnable end-to-end for the single-model OpenAI path in a normal environment. Docker execution and search were not exercised in that log.

---

## 5. Self-report accuracy

Two self-reports that **contradict each other**, so at least one is misleading:

- **`PROGRESS.md` is stale/wrong** - claims only Steps 01-03 done, Step 04 "partial," Steps 05-09 as unchecked TODO, "~40-60%." The actual tree has all adapters, indexer, prompts, UI, and `/api/turn`. Never updated after the early phase; materially understates the build.
- **`IMPLEMENTATION_COMPLETE.md` overstates the other way** - headline "8/8 steps complete (100%)". Verified inaccuracies:
  - Claims "Fast search (<100ms)" and lists search complete, but auto-indexing is missing and search returns nothing. To its credit, the *same doc's* "What's NOT Implemented" section honestly admits auto-indexing hooks are absent - directly contradicting its own "100% / search complete" headline.
  - Correctly admits Step 09 not implemented, so "100%" is really ~8/9 at best, and two of those (06, 08) are partial.
  - "43 implementation files / ~3,500 LOC" - plausible (counts docs/config; actual code ~33 files / 3,347 LOC).

Net: neither self-report is trustworthy alone. Reality is "6 done, 2 partial, 1 missing." Honest gaps are buried in a sub-section while the headline says 100%.

---

## 6. Standouts

**Done well:**
1. **Spec fidelity of the core spine.** Schema, FS/DB split, markdown-conversation format, Docker invocation, three-provider tool loop all match ARCHITECTURE closely and coherently - and it produced a real saved agent turn.
2. **Provider breadth + clean adapter separation.** Three adapters each handle their provider's distinct tool-call/result shape correctly; parallel `Promise.all` with per-model error capture is exactly the reference contract.
3. **Consistent, low-noise code** with uniform error handling and parameterized SQL across every route.

**Done poorly:**
1. **Search shipped inert** - the whole indexing subsystem exists but is never called, so a headline feature silently does nothing, untested.
2. **Contradictory/inflated self-reports** - stale PROGRESS.md plus a "100%" doc that overstates search and glosses UI/e2e gaps.
3. **UI missing two named deliverables** (file upload, search) and **package.json advertises three test scripts whose files don't exist**, so `npm run test:all` is broken out of the box.

---

## 7. Scorecard

- **LOC:** ~3,347 (server + web source); ~110KB SQLite DB with real sample data.
- **Source files:** ~33 code files (+ Dockerfile, schema.sql, 4 docs).
- **Phase-1 spec delivered:** ~75% (6/9 DONE, 06 & 08 PARTIAL, 09 MISSING).
- **One-line characterization:** A faithful, clean, spec-shaped implementation whose core (schema -> files -> markdown convos -> Docker -> multi-provider tool loop -> basic UI) genuinely runs end-to-end for a single model, undercut by a search feature that's fully coded but never wired in, a chat-only UI missing upload/search, no context management, and self-reports that swing from stale-understated to 100%-overstated.
