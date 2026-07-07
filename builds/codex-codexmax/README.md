# Multi-Model Chat

Project-aware AI orchestration system: query multiple models (GPT-4, Claude, Gemini) in parallel with shared context, persistent file storage, and sandboxed code execution.

## Core Capabilities

Models operate on a project directory with full read/write access and bash execution:
- File I/O via filesystem (not database blobs)
- Code execution in ephemeral Docker containers
- Package installation into project-local environments (.venv, node_modules)
- Search across files and conversation history (unified FTS5 index)

Conversations stored as markdown files with YAML frontmatter. Database tracks metadata only—files are source of truth.

## Quick Start

Requirements: a recent Node.js LTS release (use the latest stable LTS, e.g. Node 20+ at the time of writing), Docker Desktop, and API keys for OpenAI/Anthropic.

```bash
npm install
cp .env.example .env   # fill in OPENAI/ANTHROPIC keys

# Build executor image (once)
docker build -t multimodelchat-executor -f server/execution/Dockerfile server/execution

# Start server + static UI
npm start
# http://localhost:3000
```

Useful scripts:
- `node server/db/test-schema.js` — schema smoke test
- `node server/test-file-apis.js` — filesystem + metadata
- `node server/test-conversations.js` — markdown conversations
- `node server/execution/test-docker.js` — Docker executor
- `node server/test-search.js` — FTS5 indexing
- `node server/test-prompts.js` — system prompt builder
- `node server/test-context.js` — context/summarization helpers
- `node server/test-turn.js` — `/api/turn` flow (server running)
- `node server/test-e2e.js` — end-to-end (server running)

## Architecture Overview

```
projects/{project-id}/
  files/
    .venv/              # Python virtualenv (models create)
    node_modules/       # npm packages (models install)
    .conversations/     # Markdown files with message content
      {conv-id}/
        rounds/
          001-user.md
          001-agent-<model-id>.md
    data/               # User data files
    scripts/            # Model-generated code
```

**Key constraints:**
- Files live on filesystem, not in database (enables direct editing, git versioning)
- Docker provides sandboxing (resource-limited; network enabled by default but can be disabled per project)
- Ephemeral containers (`docker run --rm`) simplify lifecycle management
- FTS5 indexes both file content and conversation messages (single search interface)

## Design Decisions

**Why filesystem storage instead of database blobs?**
Direct filesystem access enables standard tools (editors, git, grep). Users can browse, edit, and version control project files. Database stores metadata only (paths, hashes, timestamps) for indexing and change detection.

**Why Docker for execution?**
Isolation without OS-level virtualization complexity. Containers mount project directory read-write but cannot access host filesystem outside project. Resource limits (memory, CPU, timeout) prevent runaway processes.

**Why ephemeral containers?**
Stateless execution simplifies orchestration. Each bash command runs in fresh container with project directory mounted. Models install packages into project-local environments (.venv, node_modules) which persist on host filesystem across container invocations.

**Why conversations as markdown?**
Human-readable format enables direct inspection and editing. YAML frontmatter provides structured metadata (speaker, model, tokens). Full-text searchable alongside code files.

## Technology Stack

| Component | Implementation | Rationale |
|-----------|---------------|-----------|
| Backend | Node.js + Express | Async I/O for concurrent model queries |
| Database | SQLite + FTS5 | Embedded storage, full-text search without external service |
| Execution | Docker | Cross-platform sandboxing with resource limits |
| Storage | Filesystem | Direct access, standard tooling, version control |

## Documentation Structure

- [VISION.md](VISION.md) — Problem statement, design principles, success criteria
- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, component interactions, schema
- [ROADMAP.md](ROADMAP.md) — Implementation phases, dependencies, time estimates
- [CLAUDE.md](CLAUDE.md) — Guidelines for AI assistants working on codebase
- [specs/](specs/) — Step-by-step implementation guides (8 phases, ~25-30 hours)

## Development Status

Phase 1–3 implemented (schema, filesystem storage, conversations, Docker execution, tool calling, search, prompts, UI, context management). See [ROADMAP.md](ROADMAP.md) for next refinements.

## License

MIT
