# Build: Codex (GPT-5 codex-max)

Analyzed at `~/staging/from-zip/multi-model-chat-codex-codexmax/` against the shared spec at `~/staging/from-zip/multi-model-chat/`. This is the most complete of the builds I'd expect: all 9 numbered specs are substantially implemented, including the optional context-management spec (09). ~3,960 LOC across ~38 source files (7 of them test scripts).

## 1. Scope & completeness vs the 9 specs

| Spec | Status | Evidence |
|------|--------|----------|
| 01 project-setup & schema | **DONE** | `server/db/schema.sql` (all reference tables), `db/index.js` (WAL + FK pragma), `db/migrations.js` (versioned via `config.schema_version`), `db/projects.js`, `db/config.js`, `db/test-schema.js` |
| 02 filesystem-storage | **DONE** | `files/storage.js` (create/read/list/update/delete + `hasFileChanged` hash detection), `files/routes.js` (multipart + JSON-text upload, GET content, PUT, DELETE), `utils/hash.js` (SHA256), `utils/sanitize.js` (traversal guard) |
| 03 conversations-as-files | **DONE** | `conversations/writer.js` (markdown + YAML frontmatter, `NNN-speaker.md`), `reader.js` (frontmatter parse), `routes.js`, custom `utils/yaml.js` formatter+parser |
| 04 docker-execution | **DONE** | `execution/Dockerfile` (ubuntu:24.04 + python/node/pixi), `execution/docker.js` (`docker run --rm`, `-v/-w/--memory/--cpus/--network/--user`, timeout, env passthrough; plus `isDockerAvailable`/`isImageBuilt`/`buildImage`), `execution/test-docker.js` |
| 05 tool-integration | **DONE (OpenAI+Anthropic); Google MISSING** | `adapters/openai.js` + `adapters/anthropic.js` (full tool loops, `MAX_TOOL_ITERATIONS=10`, usage accumulation); `execution/tools.js` (`BASH_TOOL`); `server.js` `/api/turn` parallel via `Promise.all`. `adapters/google.js:5` is a stub that throws `'Google adapter not implemented'` |
| 06 unified-search | **DONE (file-type filter absent)** | `indexing/chunker.js`, `indexer.js` (`indexFile`/`indexMessage`/`reindexProject`, delete-then-reinsert), `search.js` (`bm25`, `snippet`, type filter). Auto-index wired into `createFile`/`updateFile`/`saveMessage`. Spec 06's "filter by file type" is not implemented — only `includeFiles`/`includeConversations` |
| 07 system-prompts | **DONE** | `prompts/builder.js` (`buildSystemPrompt` + `buildMessages`), `prompts/templates.js` (per-provider prompts, file listing capped at 20, venv/pixi/npm instructions, round context) |
| 08 ui-and-testing | **DONE (no QUICKSTART.md)** | `web/index.html` + `app.js` + `styles.css` (project/conv selectors, model checkboxes, upload, debounced search, usage display, loading spinners); tests `test-{file-apis,conversations,search,prompts,context,turn,e2e}.js`. Spec's `QUICKSTART.md` absent — README covers it |
| 09 conversation-context-management | **DONE** | `conversations/context.js` (`estimateConversationTokens`, `needsSummarization`, `getContextMessages` w/ truncation accounting, `createSummary`), `summarizer.js` (`summarizeRounds` via model -> stored in `conversations.settings.summary`), integrated into `builder.js`; endpoints `/summarize` + `/stats`. Detection present; automatic trigger inside `/api/turn` is not wired (manual endpoint only) — consistent with the spec's deliverable list |

Nothing is outright missing except the Google provider. Every other spec is present and coherent end-to-end.

## 2. Architecture choices & divergences from the reference

Overwhelmingly **FOLLOW**, and faithfully so:

- **SQLite library:** `better-sqlite3` — exactly as ARCHITECTURE.md specifies.
- **Storage layout:** filesystem as source of truth; `projects/{id}/files/.conversations/{conv}/rounds/NNN-{speaker}.md` matches the reference tree precisely; DB holds metadata only.
- **Schema:** `retrieval_index` FTS5 with `tokenize='porter unicode61'`, `bm25()` ranking, `snippet()` highlighting — verbatim to the reference. `content_chunks` with `location` JSON matches.
- **Docker execution:** ephemeral `docker run --rm` with volume mount, memory/CPU caps, network toggle, timeout — matches the reference model.
- **Provider prompt contract:** correctly honors the subtle spec detail — OpenAI gets the system prompt as a leading `{role:'system'}` message; Anthropic gets it via the separate `system` param with only user/assistant turns (`builder.js` + adapters).

Deliberate **DIVERGE** points, mostly reasonable:
- **Ubuntu 24.04 vs spec's 22.04** in the Dockerfile — a benign upgrade.
- **`--user ${UID||1000}:${GID||1000}`** on the container — a good security instinct (avoids root-owned files on the host mount) that the reference doesn't call for. But it conflicts with pixi, which the Dockerfile installs under `/root/.pixi`; pixi would be unreachable as uid 1000. venv/npm paths are unaffected, so the practical impact is limited to the pixi path.
- **Extra columns:** `projects.description` and `conversations.settings` — the latter is justified (it stores the round summary); both are harmless additions.
- **Additional-volumes** from project settings (an optional ARCHITECTURE feature) is not implemented; `allow_network` toggle is.

## 3. Code quality

Genuinely strong. Clean modular decomposition that mirrors ARCHITECTURE.md's directory DAG one-to-one. Consistent `try/catch` in every route, per-model error isolation in `/api/turn` (one model failing returns `{error}` while others proceed), and tool loops bounded by `MAX_TOOL_ITERATIONS` with graceful partial-response fallback and usage accumulation.

Tests: 7 script-style test files plus `test-turn.js`/`test-e2e.js`. I could **not execute** them here — the sandbox has no C toolchain (`make`/`gcc` absent) and node-gyp's bundled undici is broken on Node 20, so `better-sqlite3`'s native binary couldn't be built and the prebuilt download was blocked. This is an environment limitation, not a build defect. As a partial substitute, every `.js` file under `server/` and `web/` passes `node --check` (no syntax errors), and the committed `storage/data.db` already carries the full migrated schema (verified via file inspection).

Bugs / nits (cited):
- **Dead schema:** `schema.sql:29` declares `project_files_path_fts` (an external-content FTS5 over file paths) that is **never populated or queried** anywhere in `server/` — abandoned path-search feature.
- **Docker/pixi mismatch:** `execution/docker.js` runs as uid 1000 while `execution/Dockerfile` installs pixi to `/root/.pixi` — pixi unusable for that user (venv still works).
- **Search filter gap:** spec 06's file-type filter is unimplemented (`indexing/search.js` only splits file vs conversation).
- **Message chunking:** `indexer.js indexMessage` stores each message as a single chunk regardless of length; fine per spec (messages assumed <500 tokens) but long agent turns won't be chunked.
- **Naive YAML:** `utils/yaml.js` is a hand-rolled one-level parser; adequate for this frontmatter, fragile if frontmatter ever nests deeper.
- **Cosmetic:** `server.js` `/api/turn` has an inconsistently indented `if (!conversationId)` block (2 vs 4 spaces).
- **Committed artifact:** `storage/data.db` is shipped pre-migrated (gitignored going forward, but present in the zip).

Hardcoded values are all sensible and match ARCHITECTURE (`MAX_CONTEXT_TOKENS=100000`, `SUMMARIZATION_THRESHOLD=80000`, `MAX_TOOL_ITERATIONS=10`, `--memory 1g`, `--cpus 2.0`; UI defaults `gpt-4o-mini`/`claude-sonnet-4-5`; summarizer default `gpt-4o-mini`).

Note (not attributable to this build): the repo ships a real-key-shaped `.env`, but it is **byte-identical** to the shared template's `.env` (`diff -q` confirms) — it came from the environment, not the model.

## 4. Runnability

- `npm install` **succeeds** (156 packages).
- Entry point is clean: `npm start` -> `server/server.js`, which runs migrations on boot, mounts all routes, serves `web/` statically, listens on `PORT` (default 3000).
- The only thing preventing an actual boot **in this sandbox** is the `better-sqlite3` native binary (no compiler + blocked prebuilt download) — an environment constraint. In a normal environment with a prebuilt binary or build toolchain, nothing in the code blocks startup. Full `/api/turn` additionally needs API keys and a built Docker image; search/schema/prompt/context tests need only working sqlite.
- **Verdict: partial** — installs cleanly and is structurally runnable; couldn't be booted here purely due to the sandbox lacking the native sqlite build.

## 5. Self-report accuracy

No dedicated completion/summary doc (no `COMPLETION.md`; the spec's `QUICKSTART.md` was not produced). The closest self-report is the edited `README.md`, which claims: *"Phase 1-3 implemented (schema, filesystem storage, conversations, Docker execution, tool calling, search, prompts, UI, context management)."* That claim is **accurate** against the code, and the README's list of runnable test scripts matches the actual files present. No inflation detected — the one thing the README arguably oversells is multi-provider breadth (it name-drops Gemini/GPT-4/Claude in the intro while Google is a stub), but it never explicitly claims Google works.

## 6. Standouts

**Notably well:**
1. **Full breadth including spec 09.** Real token estimation, model-driven summarization persisted to conversation metadata, context-window truncation with an accounting of dropped messages, and a truncation/summary notice injected into the system prompt — a spec most builds would skip entirely.
2. **High architectural fidelity.** Directory layout, schema, FTS5 config, ephemeral Docker, and markdown+frontmatter all track ARCHITECTURE.md closely, and the provider-specific system-prompt handling gets the reference's subtle OpenAI-vs-Anthropic contract right.
3. **Disciplined orchestration.** Bounded tool loops, usage accumulation across tool rounds, and per-model failure isolation in the parallel `/api/turn`.

**Notably poorly:**
1. **Google adapter is a throwing stub** despite being a named deliverable in spec 05 and being advertised in the UI/README — the one true completeness hole.
2. **Dead `project_files_path_fts` table** — declared but never used; a half-planned feature left in the schema.
3. **Small untested correctness gaps** the (unrunnable-here) tests didn't catch: the non-root-user vs pixi-in-`/root` conflict, and the missing file-type search filter from spec 06.

## 7. Scorecard

- **LOC:** ~3,960 across server + web (includes 7 test scripts).
- **Source files:** ~38 (`.js`/`.sql`/`.html`/`.css`) + Dockerfile.
- **Phase-1 spec delivered:** ~90-95%. All 9 specs substantially present; deductions for the Google stub, unused FTS table, missing file-type filter, no automatic summarization trigger, and inability to execute tests here.
- **One-line characterization:** A faithful, near-complete implementation that hews closely to the reference architecture and even delivers the optional context-management spec — let down mainly by a stubbed Google provider and a little dead code.
