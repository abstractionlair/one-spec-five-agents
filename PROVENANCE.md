# Provenance

This document declares every deviation between this repository and the
recovered experiment artifacts. Anything not listed here is as-built.

## 1. What this repository is assembled from

The contents were extracted from a zip archive of a Mac disk copy (the
machine the November 2025 experiment ran on). Zip extraction flattened all
file modification times, so filesystem dates carry no information; dating
evidence is internal to the files themselves — npm debug logs
(`builds/antigravity/projects/*/files/.npm-cache/_logs/`, dated 2025-11-23),
SQLite row timestamps in the `storage/data.db` files, and the dependency
version floors recorded in each build's `package-lock.json`.

Directory mapping from the extraction to this repository:

| Source (from-zip) | Here |
|---|---|
| `multi-model-chat/` | `spec/` |
| `multi-model-chat-claude-code-sonnet45/` | `builds/claude-code-sonnet45/` |
| `multi-model-chat-droid-sonnet45/` | `builds/droid-sonnet45/` |
| `multi-model-chat-codex-codexmax/` | `builds/codex-codexmax/` |
| `multi-model-chat-gemini/` | `builds/gemini/` |
| `multi-model-chat-antigravity/` | `builds/antigravity/` |
| `multi-model-chat-restart/` | `restart/` |
| `ANALYSIS-<agent>.md` (July 2026 evaluation) | `analysis/<agent>.md` |
| `COMPARISON-STUDY.md` (July 2026 evaluation) | `STUDY.md` |
| first-person account (July 2026) | `README.md` |

The analysis files, the study, and the account were written in July 2026;
they are evaluation documents, not experiment artifacts.

## 2. Removals

- **`.env` files — 7 removed** (one at the root of `spec/`, `restart/`, and
  each of the five builds). They contained real API credentials.
  `.env.example` files are retained.
- **`node_modules/` — 5 directories removed** (one per build; ~184 MB,
  ~18,200 files total: antigravity 601 files, claude-code-sonnet45 3,463,
  codex-codexmax 3,526, droid-sonnet45 5,659, gemini 4,954). Each build's
  `package-lock.json` is retained as dating and dependency-resolution
  evidence.
- **npm cache bulk — removed from 2 caches** under
  `builds/antigravity/projects/*/files/.npm-cache/`:
  `_cacache/` (448 KB, from `proj_mibq74j9_7hr2w8`) and
  `_update-notifier-last-checked` (0 bytes, from `proj_mibqg6m6_3nfqvr`).
  The `_logs/` directories are retained in full (four npm debug logs dated
  2025-11-23) as dating evidence.
- **OS/tool droppings** (`.pytest_cache/`, `__pycache__/`, `.DS_Store`,
  `venv/`): none were present in the extraction; nothing removed under this
  rule.

## 3. Redactions

A sweep for credential material (OpenAI `sk-proj-`, Anthropic `sk-ant-`,
Google `AIzaSy`, GitHub `ghp_`, xAI `xai-`, bearer tokens, `key=` URL query
parameters, marketing `mkt_tok` tokens) was run over every file in the tree,
including `server.log`, the npm debug logs, saved conversation files, and
the SQLite databases (inspected via `strings`). **No credential values were
found; nothing required redaction.** The 32 occurrences of `sk-ant-...` in
documentation are literal placeholders from the spec pack, retained as-is.

Username replacements (the only content edits inside `spec/` and `builds/`):
the example path `/Users/scott/Documents/data` was changed to
`/Users/<user>/Documents/data` in one line of each copy of the architecture
document:

- `spec/ARCHITECTURE.md:340`
- `builds/antigravity/ARCHITECTURE.md:340`
- `builds/claude-code-sonnet45/ARCHITECTURE.md:342`
- `builds/codex-codexmax/ARCHITECTURE.md:340`
- `builds/droid-sonnet45/ARCHITECTURE.md:340`
- `builds/gemini/ARCHITECTURE.md:340`

## 4. Retained with note

`/Volumes/Share 1/...` paths appear in
`builds/claude-code-sonnet45/SETUP.md` (1 line),
`builds/claude-code-sonnet45/PROGRESS.md` (1 line), and
`builds/claude-code-sonnet45/server.log` (26 lines, in stack traces), and
are quoted once in `analysis/claude-code-sonnet45.md`. They contain no
identity content (no username component) and are retained: they are
build-time context evidence that the claude-code-sonnet45 build ran from an
external volume on the original machine.

## 5. Known caveat: droid-sonnet45 lockfile

`builds/droid-sonnet45/package-lock.json` was refreshed in June 2026,
after the experiment, during recovery work. Unlike the other four builds'
lockfiles, it is **not** build-time evidence and should not be used to date
that build.

## 6. Document adaptations (July 2026 evaluation documents only)

`README.md` and `STUDY.md` differ from their source drafts only in
repository-relative links added at publication: the README links its
companion study (`STUDY.md`), the per-build analyses (`analysis/`), the
[MultiModelChat](https://github.com/abstractionlair/MultiModelChat)
repository, and the
[claude-hub](https://github.com/abstractionlair/claude-hub) repository;
the study's frontmatter identifies its companion piece as this repository's
README. No other wording was changed. The five `analysis/*.md` files are
byte-identical to their sources. A root `.gitignore` and this
`PROVENANCE.md` were added at publication.

## 7. Fidelity statement

Apart from the removals in §2, the six single-line username replacements in
§3, and the added root files in §6, every file under `spec/`, `builds/`,
and `restart/` is byte-identical to the recovered artifacts. This was
verified with a recursive diff between this tree and the extraction before
committing.
