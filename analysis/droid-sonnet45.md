# Build: Factory Droid (Sonnet 4.5)

Analysis of `~/staging/from-zip/multi-model-chat-droid-sonnet45/` against the shared spec
(`~/staging/from-zip/multi-model-chat/`: VISION, ARCHITECTURE, ROADMAP, specs/01-09).

Verified by reading all source, running the pure-JS units, inspecting the committed
`storage/data.db`, and attempting `npm install` + tests. Adversarial where warranted.

---

## 1. Scope & completeness vs the 9 specs

| Spec | Status | Evidence |
|------|--------|----------|
| 01 project-setup & schema | **DONE** | `db/schema.sql` has all 6 tables + FTS5 `retrieval_index`; `db/migrations.js` version-tracks; `db/projects.js` + `db/config.js` CRUD; `db/test-schema.js` present. Uses better-sqlite3 (`db/index.js:1`). Committed `data.db` proves migrations ran & FTS tables created. |
| 02 filesystem-storage | **DONE** | `files/storage.js` (create/get/read/list/update/delete + `hasFileChanged`), `files/routes.js` (POST files multipart + `/files/text` JSON, GET list, GET content, PUT, DELETE), `utils/hash.js` SHA256, `utils/sanitize.js`, `test-file-apis.js`. Content on FS + metadata in DB. |
| 03 conversations-as-files | **DONE** | `conversations/writer.js` writes `.conversations/{id}/rounds/NNN-speaker.md` with YAML frontmatter (`writer.js:64-68`); `reader.js` parses; `routes.js` (create/get/list/add-message); `test-conversations.js`. Matches ARCHITECTURE path layout exactly. |
| 04 docker-execution | **DONE (code) / UNTESTED** | `execution/Dockerfile` (ubuntu22.04, python3/venv, node/npm, curl/wget/git, build-essential, pixi); `execution/docker.js` `executeBash` with `--rm -v :/project:rw -w --memory --cpus --network`, timeout+SIGTERM, `isDockerAvailable`/`isImageBuilt`/`buildImage`; `test-docker.js`. No Docker in sandbox -> not runtime-verified, but implementation is complete and matches ARCHITECTURE. |
| 05 tool-integration | **DONE (minor gap)** | `adapters/openai.js` + `adapters/anthropic.js` with full tool-call loops (MAX 10 iters, usage accumulation, graceful limit warning); `execution/tools.js` `BASH_TOOL`; `server.js` `/api/turn` runs models in parallel (`Promise.all`, `server.js:51-120`), saves responses. **Gap:** no `adapters/google.js` (a listed deliverable). |
| 06 unified-search | **MISSING** | No `server/indexing/` dir, no chunker/indexer/search, no `/api/search` route, no auto-indexing. `grep` for `retrieval_index/MATCH/bm25/snippet` outside schema.sql -> none. Only the empty FTS5 schema exists. Self-admitted not built. |
| 07 system-prompts | **DONE (minor gap)** | `prompts/builder.js` builds system prompt with project name, file listing (`builder.js:26-51`), bash-usage instructions, round number, and provider-specific handling (OpenAI system-in-messages vs Anthropic separate `system` param). **Gaps:** no `templates.js`, no pixi example, no search/summary injection (depends on 06/09). All ROADMAP success criteria for 07 met. |
| 08 ui-and-testing | **PARTIAL** | `web/index.html` (single file, inline CSS/JS): project create, up-to-2-model select, send, side-by-side response cards with token usage. **Missing:** file-upload UI, search UI, conversation-history view, and the E2E test (`server/test-e2e.js` referenced by `package.json` but absent). |
| 09 context-management | **MISSING** | No `conversations/context.js` / `summarizer.js`, no token counting, no truncation, no summary storage. `buildMessages` includes **all** messages up to the round with no "last N" cap (`builder.js:11-12`). Self-admitted not built. |

**Tally:** 6 DONE (01,02,03,04-code,05,07), 1 PARTIAL (08), 2 MISSING (06,09).
Roughly **~70%** of the full 9-spec deliverable; the core happy-path (01-05, 07) is essentially complete, and the two clean misses are the two "polish" features (search, context mgmt) plus half of the UI.

---

## 2. Architecture choices & divergences from the reference

| Area | Choice | FOLLOW / DIVERGE |
|------|--------|------------------|
| SQLite lib | `better-sqlite3` ^12.2.0 (`db/index.js:1`), WAL, `foreign_keys=ON` | **FOLLOW** - ARCHITECTURE specifies better-sqlite3. (Note: several docs still say "sql.js" - see 5. The *code* is correct.) |
| Storage layout | `projects/{id}/files/` and `.conversations/{id}/rounds/NNN-speaker.md`; content on FS, metadata in DB | **FOLLOW** - matches ARCHITECTURE and ROADMAP verbatim. |
| Docker execution | Ephemeral `docker run --rm`, volume mount, `--memory 1g --cpus 2.0 --network bridge`, 60s timeout | **FOLLOW** - matches the ARCHITECTURE container spec almost line-for-line. |
| FTS5 search | Schema DDL only (`retrieval_index` + an extra `project_files_path_fts`); **no** chunker/indexer/query code | **DIVERGE (shortcut)** - schema present but the feature is absent. `project_files_path_fts` is dead schema (nothing references it). |
| Provider adapters | OpenAI + Anthropic only; per-provider tool mapping from one `BASH_TOOL` | **DIVERGE (minor)** - Google adapter (in ARCHITECTURE + spec 05) omitted; design is otherwise clean and extensible. |
| UI | Single static `index.html`, inline CSS/JS | **DIVERGE (shortcut)** - simpler than spec; no upload/search/history. |
| Schema extras | `projects.description`, `conversations.settings` columns | **DIVERGE (benign superset)** - harmless additions. |

Net: strong, faithful adherence on the storage/DB/execution core; the divergences are all *omissions* (search feature, Google adapter, UI surface), not questionable redesigns.

---

## 3. Code quality

**Structure.** Clean and modular; directory layout mirrors ARCHITECTURE (`db/`, `files/`, `conversations/`, `execution/`, `adapters/`, `prompts/`, `utils/`). Consistent naming, small focused files (~1,900 non-test source LOC).

**Error handling.** Every route wraps in try/catch -> 500 + `err.message`. `/api/turn` isolates per-model failures so one model erroring doesn't sink the others (`server.js:110-117`). Adapters cap the tool loop and degrade gracefully with a `warning`. Reasonable for a prototype.

**Tests.** Three well-written integration suites with proper cleanup (`test-schema.js`, `test-file-apis.js`, `test-conversations.js`). They could not be executed in this sandbox (see 4) but are sound; the committed `data.db` shows they ran on the build machine.

**Bugs / latent issues (cited):**
- **Anthropic multi-agent alternation bug** - `builder.js:65-78` emits one `assistant` message per prior agent reply. A prior round with 2+ models yields consecutive `assistant` turns; Anthropic's API requires strict user/assistant alternation and will 400. Single-model conversations are fine, but this breaks the product's headline multi-model-across-rounds case.
- **No history truncation** - `buildMessages` sends the entire conversation every turn (`builder.js:11-12`); long chats will overflow context. This is the Step-09 gap surfacing in the live path.
- **`sanitizePath` over-strict** - rejects any path containing the `..` or `~` substring (`utils/sanitize.js:15`), so legitimate names like `backup~` or `my..file.txt` are refused (verified by running it). Safe, but a correctness quirk.
- **`/api/turn` unchecked conversation lookup** - a caller-supplied bad `conversationId` makes `convMeta` undefined -> `convMeta.round_count` throws (caught as a generic 500, not a 404). Minor robustness gap.

**Dead code / stale entries:** `project_files_path_fts` FTS table (never queried); `package.json` `test:search` -> `server/indexing/test-search.js` and `test:e2e` -> `server/test-e2e.js` both point to **non-existent files**; `test-schema.js:100-106` keeps a sql.js-era "cascade not working" fallback branch that's dead under better-sqlite3.

**Hardcoded values (all reasonable, match ARCHITECTURE):** `MAX_TOOL_ITERATIONS=10`, Anthropic `max_tokens 4096`, memory `1g`, cpus `2.0`, timeout `60000`.

---

## 4. Runnability

- **Entry point is coherent:** `npm start` -> `node server/server.js`, listens on `:3000`, serves `web/`, mounts project/file/conversation routes and `/api/turn`. Warns if API keys are absent.
- **`npm install` succeeded** (137 packages), **but the `better-sqlite3` native binding did not build** in this sandbox, so `require('better-sqlite3')` throws *"Could not locate the bindings file"* and the server + all DB-backed tests fail to start here. Root cause is **environmental, not code**:
  - npm `ignore-scripts=true` in this env (install script never ran), and
  - no prebuilt binary exists for better-sqlite3 v12 / node 20 / linux-x64, and
  - no C/C++ toolchain to compile (only `python3`; no `gcc`/`g++`/`make`, no sudo/apt).
- **Evidence it runs on a normal host:** the committed `storage/data.db` contains all tables plus both FTS5 virtual tables (`retrieval_index`, `project_files_path_fts`) and their shadow tables - the migration genuinely executed against better-sqlite3 on the build machine.
- **Pure-JS units verified working** by direct execution: YAML format/parse round-trips (incl. nested `usage`), markdown frontmatter parse, SHA256 (`sha256("abc")=ba7816bf...`), path-traversal blocking.
- **To actually run:** Node 20 + a C toolchain (or a resolvable prebuilt) for better-sqlite3; API keys for models; Docker only for the bash tool (server boots without it - models just can't execute code).
- **Verdict: PARTIAL** - code path is sound and would run on a properly provisioned host (as the committed DB confirms), but it does **not** run in this sandbox because the native module can't be built.

---

## 5. Self-report accuracy

Three self-report docs, plus QUICKSTART/COMPLETION. Verified against code:

**`BETTER_SQLITE3_SUCCESS.md` - largely CREDIBLE.** better-sqlite3 is genuinely the dependency (`package.json`, `db/index.js`); the committed `data.db` proves FTS5 tables were created; better-sqlite3 does support FTS5. Claims of "all tests pass" are plausible on the build machine (the three suites exist and are sound). Overreach: *"FTS5 full-text search now available"* is true only at the schema level - **no search feature exists**. The *"Why Other Agents Failed"* / "thanks to the agent who identified Node 20" section is speculative self-congratulation, not a code claim.

**`COMPLETION_SUMMARY.md` - MIXED, contains a headline OVERCLAIM.**
- *"All 8 core implementation steps completed"* (line 217) is **false** - Step 06 (search), one of the 8, is not implemented, as the same doc admits ~15 lines later ("Step 6 Not Yet Implemented").
- **Internally contradictory on the DB engine:** the intro (line 14) and Known Issues (line 227) say *"Using sql.js due to better-sqlite3 compilation issues,"* while the middle (line 71+) says *"better-sqlite3 with FTS5 Now Working!"* The code uses better-sqlite3; the sql.js sentences are stale and were never reconciled.
- *"40+ files created"* is loose (~26 code files; the count only reaches 40 by including docs). *"All tests passing (where deps available)"* - true for the 3 real suites, but 2 of the 5 `package.json` test scripts reference files that don't exist.

**`IMPLEMENTATION_NOTES.md` - MIXED.** Top correctly states better-sqlite3+FTS5 works, but Step-01 note still cites a *"sql.js limitation"* cascade warning, and Known-Limitation #1 says Step 6 was *"deferred because sql.js doesn't include FTS5"* - stale/false reasoning (they use better-sqlite3, which has FTS5; the real reason is it simply wasn't built). Honest about Docker / API-key / Step-09 gaps.

**`QUICKSTART.md` - one stale line:** the Architecture Notes call the DB *"SQLite (via sql.js)"* (line 182), again contradicting the actual better-sqlite3 code. Its endpoint list is accurate and honestly omits any search endpoint.

**Bottom line on self-reports:** the docs capture a codebase caught mid-migration (sql.js -> better-sqlite3) that was never re-proofread. The *pessimistic* doc statements undersell the code (better-sqlite3 + FTS5 schema genuinely work); the *optimistic* headline ("all steps complete") oversells it (search absent). A reader should not trust the summaries at face value in either direction.

---

## 6. Standouts

**Notably well:**
1. **Faithful architecture adherence.** Storage paths, DB schema, and the Docker container spec match ARCHITECTURE almost verbatim - the reference design was clearly read and honored rather than reinvented.
2. **Robust tool-calling loops.** Both adapters implement the multi-turn tool loop cleanly: iteration cap, cumulative token accounting, and a graceful partial-response + `warning` when the cap is hit (`openai.js:85-94`, `anthropic.js:91-102`).
3. **Real infra problem solved and evidenced.** The Node-24->20 fix for better-sqlite3 is a genuine engineering win, and it's corroborated by the committed DB (FTS tables present), not just asserted.

**Notably poorly:**
1. **Unified search (Step 06) entirely absent** despite being central to the VISION - only empty FTS5 schema. Worse, the docs oversell it as "available/ready," blurring the line between "schema exists" and "feature works."
2. **Documentation inconsistency/overclaim** - "all 8 steps complete" beside "Step 6 not implemented," and pervasive stale "sql.js" references contradicting the code. Erodes trust in the self-report.
3. **UI is half the spec** - no file upload, no search, no history browsing; and the E2E test the docs imply exists (`test-e2e.js`) is missing.
4. **Latent Anthropic alternation bug** breaks the multi-model-across-rounds scenario the product is named for.

---

## 7. Scorecard

- **LOC:** ~2,800 total (~2,350 JS incl. ~510 test, ~100 SQL, 338 HTML, 32 Dockerfile); ~1,900 non-test source LOC.
- **Source files:** 23 `.js` + `schema.sql` + `Dockerfile` + `index.html` = **26 code files** (plus `package.json` and 14 markdown docs).
- **Spec delivered:** ~**70%** of the 9-spec Phase-1 scope - Steps 01-05 + 07 complete (04 code-only, unrun), 08 partial, 06 & 09 missing.
- **One-liner:** A clean, architecture-faithful implementation that nails the storage/DB/execution/multi-model core (correct better-sqlite3 + FTS5 schema, solid tool loops) but skips the two "polish" features (search, context management) and half the UI - and ships self-report docs that both undersell (stale sql.js claims) and oversell ("all steps complete") the actual result.

**Runnable:** PARTIAL - coherent and would run on a host with a C toolchain (confirmed by the committed DB); does not run in this sandbox because the better-sqlite3 native binding can't be built here.
