# Multi-Model Chat

Project-aware AI orchestration system: query multiple models (GPT-4o, Claude, Gemini, Grok) in parallel with shared context, persistent file storage, and sandboxed code execution.

## Three-Project Architecture

The system is split into three independent projects:

| Project | Purpose | Port |
|---------|---------|------|
| [mm-search](mm-search/) | Search service (FTS + vector) | 8001 |
| [mm-server](mm-server/) | Backend API (conversations, adapters, sandbox) | 3000 |
| [mm-web](mm-web/) | Frontend UI | - |

Each project has its own README, documentation, and can be developed independently.

## Quick Start

```bash
# 1. Start Postgres (required by mm-search and mm-server)
# Ensure Postgres is running with pgvector extension

# 2. Start mm-search
cd mm-search
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env  # Configure DATABASE_URL
uvicorn src.main:app --host 127.0.0.1 --port 8001

# 3. Start mm-server (new terminal)
cd mm-server
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env  # Configure DATABASE_URL, API keys
uvicorn src.main:app --host 0.0.0.0 --port 3000

# 4. Start mm-web (new terminal)
cd mm-web
npm install
npm run dev
# Open http://localhost:5173
```

## Core Capabilities

- **Multi-model conversations** - Query GPT-4o, Claude, Gemini in parallel
- **Roundtable pattern** - Models see each other's responses
- **Filesystem storage** - Files in `/srv/projects/`, not database blobs
- **Sandboxed execution** - Bubblewrap on Linux (~1ms startup)
- **Hybrid search** - Postgres FTS + pgvector + Qwen3 embeddings
- **Markdown conversations** - Human-readable, git-compatible

## Architecture Overview

```
Browser → mm-web → mm-server → mm-search
                      ↓
                  Postgres
                      ↓
              /srv/projects/
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design.

## Documentation

| Document | Purpose |
|----------|---------|
| [VISION.md](VISION.md) | Goals, principles, success criteria |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, components, deployment |
| [ROADMAP.md](ROADMAP.md) | Implementation phases |

### Per-Project Documentation

Each project has its own:
- README.md - Quick start
- VISION.md - Project scope
- ARCHITECTURE.md - Component design
- AGENTS.md - AI assistant guidelines
- specs/ - Implementation guides

## Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Python 3.12+, FastAPI |
| Database | PostgreSQL + pgvector |
| Embeddings | Qwen3-Embedding-0.6B |
| Execution | Bubblewrap (Linux) |
| Frontend | Vanilla JavaScript |

## Development Status

Implementation incomplete. See [ROADMAP.md](ROADMAP.md) for progress.

## License

MIT
