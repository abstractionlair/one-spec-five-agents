# Repository Guidelines for AI Assistants

This file provides repo-specific guidance for GPT/Codex CLI (and other AI assistants) working in this project. It applies to the entire repository rooted at this directory.

Before making non-trivial changes, read:
- `README.md` for high-level capabilities and quickstart
- `VISION.md` for goals and success criteria
- `ARCHITECTURE.md` for component layout and data flow
- `ROADMAP.md` for implementation order and status
- `CLAUDE.md` for detailed coding patterns and conventions
- `specs/` for phase-by-phase implementation details

## Project Structure & Responsibilities

- `server/` — Express backend and orchestration:
  - `server/server.js` — HTTP routes and high-level orchestration of turns.
  - `server/db/` — SQLite connection (`better-sqlite3`), schema, and migrations.
  - `server/adapters/` — Model provider adapters (OpenAI, Anthropic, Google, etc.).
  - `server/execution/` — Docker-based code execution utilities and bash tools.
  - `server/conversations/` — Read/write conversation markdown files with YAML frontmatter.
  - `server/indexing/` — Chunking, indexing, and FTS5 search.
  - `server/prompts/` — System prompt construction and template logic.
  - `server/utils/` — Shared utilities (IDs, path handling, hashing, logging).
- `web/` — Static UI (`index.html`, `app.js`) for invoking `/api/turn` and viewing results.
- `projects/` — Gitignored per-project workspaces:
  - `{project-id}/files/` — User-visible workspace (data, scripts, environments, conversations).
- `storage/` — SQLite database (`data.db`) containing metadata and search index, not file content.

When adding new modules, place them under the appropriate `server/` subdirectory instead of creating new top-level trees.

## Build, Run, and Test

- Install dependencies: `npm install`
- Local server: `npm start` (serves API at `http://localhost:3000` and static UI).
- Targeted tests (once implemented): prefer focused Node scripts in `server/` such as:
  - `node server/test-schema.js`
  - `node server/test-file-apis.js`
  - `node server/test-conversations.js`
  - `node server/test-e2e.js` (with the server running)
- For new functionality, follow the testing patterns sketched in `CLAUDE.md`:
  - Write small, script-style test runners that clearly log each scenario.
  - Ensure tests clean up any data they insert into the database or filesystem.

If the repository is in an early, partially implemented state, align new entry points and test scripts with the structure and naming outlined in `ARCHITECTURE.md` and `specs/` rather than inventing new patterns.

## Coding Style & Conventions

Use the conventions in `CLAUDE.md` as the primary style reference. In particular:
- JavaScript:
  - Node.js (latest stable LTS), CommonJS modules (`require`, `module.exports`).
  - 2-space indentation, semicolons, and single quotes for strings.
  - Prefer async/await over callbacks or raw Promise chains.
  - Use descriptive names (`projectId`, `conversationId`), avoid cryptic abbreviations.
- Database access (SQLite via `better-sqlite3`):
  - Use prepared statements and transactions as shown in `CLAUDE.md`.
  - Keep content out of the database—only metadata, hashes, and indexes go into SQLite.
- Filesystem operations:
  - Use `fs.promises` with absolute paths rooted in the project directory.
  - Sanitize all user-provided paths (no `..`, `~`, or absolute paths).
  - Conversations and user files live under `projects/{project-id}/files/`.
- Error handling:
  - Use try/catch around async boundaries and return structured error responses from HTTP handlers.
  - Log failures with enough context to debug, without leaking secrets.

When in doubt about style or structure, mirror the examples in `CLAUDE.md` and the existing server modules rather than introducing new patterns.

## Implementation Order & Scope

- Follow `ROADMAP.md` and `specs/` for sequencing:
  1. Database schema and configuration (foundation).
  2. File storage and metadata tracking.
  3. Conversation storage (markdown with frontmatter).
  4. Docker-based execution and bash tools.
  5. Tool integration and orchestration logic.
  6. Search (chunking + FTS5).
  7. System prompts and multi-model coordination.
  8. UI polish.
- Avoid jumping ahead in the roadmap with large, speculative implementations. Implement the smallest slice that satisfies the spec for the current phase.
- Prefer incremental, well-scoped changes over broad refactors, especially while the system is still coming together.

## Testing & Validation Expectations

- Whenever you introduce new logic in `server/`, add or update a corresponding test script or manual check scenario.
- For data-affecting changes:
  - Confirm that files are written to the correct locations under `projects/{project-id}/files/`.
  - Verify that metadata tables (`projects`, `project_files`, `conversations`, `conversation_messages`, `content_chunks`) stay in sync with the filesystem.
- For search-related changes, validate both:
  - Raw data in `content_chunks` / `retrieval_index`.
  - End-to-end `/api/projects/:id/search` behavior.

Use simple Node scripts and `sqlite3` CLI commands as described in `CLAUDE.md` and `ARCHITECTURE.md` to inspect intermediate state.

## Security, Storage, and Execution

- Do not store full file or conversation content in the database—only metadata, hashes, and search chunks.
- Never commit `.env` or `projects/` contents. Assume `projects/` may contain user secrets and large files.
- All code execution for tools must go through the Docker-based executor:
  - No arbitrary `child_process` usage for untrusted commands outside the executor.
  - Containers should be ephemeral (`docker run --rm`) and resource-limited, as described in `ARCHITECTURE.md`.
- Keep API keys and secrets in environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.), never hard-coded or surfaced to the browser.

When modifying execution or adapter code, respect the security and isolation guarantees described in `ARCHITECTURE.md`.

## Multi-Model & Adapter Design

- Adapters in `server/adapters/` should:
  - Expose a clear, minimal interface for sending messages (e.g., `sendOpenAI`, `sendAnthropic`, `sendGoogle`).
  - Accept normalized inputs (project context, system prompt, conversation messages, tool configuration) and hide provider-specific details.
  - Return consistent response shapes, including usage and any tool-call metadata.
- Conversation metadata should:
  - Use `speaker` values like `"user"` or `"agent:{model-id}"`.
  - Track `provider` and `model_id` separately in the database.
- When adding or updating adapters, keep behavior parallel across providers where practical (e.g., tool calling semantics, error handling, logging).

## Assistant Behavior in This Repo

- Before large changes, scan for existing patterns that satisfy the same need and extend them instead of starting from scratch.
- Keep changes narrow in scope and aligned with the roadmap phase you are working on.
- Prefer clarity over cleverness:
  - Small, well-named functions.
  - Explicit control flow.
  - Minimal, focused abstractions.
- Update relevant documentation (`README.md`, `CLAUDE.md`, `specs/`) when you change APIs, data formats, or behavior that those documents describe.

If you are unsure whether a change fits the intended architecture, consult `ARCHITECTURE.md` and `ROADMAP.md` first, and err on the side of leaving existing design decisions in place.
