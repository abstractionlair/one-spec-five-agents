# Guidelines for AI Assistants

This document provides instructions for AI coding assistants (Claude, GPT, Gemini, Droid, etc.) working on this codebase.

**Note:** If you're reading a wrapper file (CLAUDE.md, GEMINI.md, DROID.md), the full guidelines are here in AGENTS.md.

## Three-Project Architecture

This repository contains three independent projects:

| Project | Purpose | Guidelines |
|---------|---------|------------|
| [mm-search](mm-search/) | Search service | [mm-search/AGENTS.md](mm-search/AGENTS.md) |
| [mm-server](mm-server/) | Backend API | [mm-server/AGENTS.md](mm-server/AGENTS.md) |
| [mm-web](mm-web/) | Frontend UI | [mm-web/AGENTS.md](mm-web/AGENTS.md) |

**When working on a specific project**, refer to that project's AGENTS.md for focused guidelines.

**This file** provides system-wide guidelines and coding conventions that apply across all projects.

## Project Overview

Multi-model chat system with:
- **Filesystem storage** - Files live in `/srv/projects/` directories
- **Bubblewrap execution** - Sandboxed code execution (Linux)
- **Markdown conversations** - Conversation history as .md files
- **Unified search** - Postgres FTS + pgvector across files and conversations
- **Local embeddings** - Qwen3-Embedding-0.6B via sentence-transformers

Read [VISION.md](VISION.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first for context.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Python 3.12+, FastAPI, uvicorn |
| Database | PostgreSQL 17, asyncpg, pgvector |
| File Watching | watchdog (inotify on Linux) |
| Embeddings | sentence-transformers, Qwen3-Embedding-0.6B |
| Execution | Bubblewrap (Linux namespaces) |
| Frontend | Vanilla JS + esbuild |

## Coding Conventions

### Python Style

```python
# Python 3.12+, type hints required
from pathlib import Path
from dataclasses import dataclass
from typing import Any

import asyncpg
from fastapi import APIRouter, HTTPException

# 4-space indentation (PEP 8)
def example_function(param1: str, param2: int | None = None) -> dict:
    """Docstrings for public functions."""
    if param1:
        return {"value": param2}
    return {}


# Async/await for I/O operations
async def fetch_data(project_id: str) -> list[dict]:
    rows = await query("SELECT * FROM projects WHERE id = $1", project_id)
    return [dict(row) for row in rows]


# Descriptive snake_case names
project_id = "proj_123"          # Good
pid = "proj_123"                 # Bad

# Double quotes for strings (consistent with Black formatter)
message = "Hello world"
template = f"User {name} said: {message}"
```

### Database Queries

```python
# Use asyncpg for async Postgres access
import asyncpg

# Connection pool (initialize at startup)
pool: asyncpg.Pool | None = None

async def init_db() -> asyncpg.Pool:
    global pool
    pool = await asyncpg.create_pool(
        "postgresql://localhost/multimodelchat",
        min_size=2,
        max_size=20
    )
    return pool


# Parameterized queries with $1, $2 placeholders
async def get_project(project_id: str) -> dict | None:
    row = await pool.fetchrow(
        "SELECT * FROM projects WHERE id = $1",
        project_id
    )
    return dict(row) if row else None


# Transactions for multi-step operations
async with pool.acquire() as conn:
    async with conn.transaction():
        file_id = new_id("file")
        await conn.execute(
            "INSERT INTO project_files (id, project_id, path) VALUES ($1, $2, $3)",
            file_id, project_id, path
        )
        # More operations...
```

### File Operations

```python
# Use pathlib for paths, aiofiles for async I/O
from pathlib import Path
import aiofiles
import aiofiles.os

# Use Path objects, not string concatenation
PROJECTS_ROOT = Path("/srv/projects")
project_path = PROJECTS_ROOT / project_id / "workspace"
file_path = project_path / sanitized_path

# Create directories recursively
await aiofiles.os.makedirs(file_path.parent, exist_ok=True)

# Write files
async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
    await f.write(content)

# Read files
async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
    content = await f.read()
```

### Error Handling

```python
# Use try-except for async operations
try:
    result = await some_async_operation()
    return result
except ValueError as e:
    # Known error types
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    # Unexpected errors
    logger.error(f"Operation failed: {e}")
    raise HTTPException(status_code=500, detail="Internal server error")


# FastAPI automatic error responses
from fastapi import HTTPException

@router.get("/files/{file_id}")
async def get_file(file_id: str):
    file = await storage.get_file(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return file
```

### Pydantic Models

```python
# Use Pydantic for request/response validation
from pydantic import BaseModel
from datetime import datetime


class ProjectCreate(BaseModel):
    """Request to create a project."""
    name: str
    description: str = ""
    settings: dict[str, Any] = {}


class ProjectResponse(BaseModel):
    """Project data response."""
    id: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True  # Allow ORM mode
```

## Project Structure

### Key Directories

```
server/
  main.py           - FastAPI app entry point
  db/               - Database schema, migrations, asyncpg connection
  adapters/         - Model provider APIs (OpenAI, Anthropic, etc.)
  execution/        - Bubblewrap sandbox execution
  conversations/    - Read/write conversation .md files
  indexing/         - Postgres FTS + pgvector search, embeddings
  files/            - File storage management
  prompts/          - System prompt construction
  utils/            - Shared utilities
  tests/            - Test modules

indexer/            - Separate daemon for file watching
  main.py
  watcher.py        - watchdog FileSystemEventHandler
  processor.py      - Index updates

/srv/projects/      - USER DATA (on Linux host)
  {project-id}/
    workspace/      - Project workspace (mounted in sandbox)
    .pyenv/         - Project-local Python versions
    .nvm/           - Project-local Node.js versions
    .metadata/      - Conversations, app data
```

### Configuration

```python
# Environment variables in .env (gitignored)
# DATABASE_URL=postgresql://localhost/multimodelchat
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...

import os
from dotenv import load_dotenv

load_dotenv()

# Access via os.environ or os.getenv
api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY not set")

# Store app config in database
config = await get_config("system_prompts")
```

## Common Patterns

### ID Generation

```python
import time
import secrets


def new_id(prefix: str = "item") -> str:
    """Generate a unique ID with prefix."""
    timestamp = int(time.time() * 1000)
    random_part = secrets.token_hex(3)
    return f"{prefix}_{timestamp:x}_{random_part}"


project_id = new_id("proj")  # proj_18f4a2b3c_d4e5f6
file_id = new_id("file")
```

### Path Sanitization

```python
from pathlib import PurePosixPath


def sanitize_path(user_path: str) -> str:
    """Sanitize user-provided paths to prevent directory traversal."""
    if not user_path or not isinstance(user_path, str):
        raise ValueError("Invalid path: must be a non-empty string")

    path = PurePosixPath(user_path)
    parts = [p for p in path.parts if p and p != "."]

    if ".." in parts or "~" in user_path:
        raise ValueError("Invalid path: directory traversal not allowed")

    if path.is_absolute():
        raise ValueError("Invalid path: absolute paths not allowed")

    return "/".join(parts)
```

### Content Hashing

```python
import hashlib


def hash_content(content: bytes | str) -> str:
    """Generate SHA256 hash for change detection."""
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()


# Use for change detection
new_hash = hash_content(file_content)
old_hash = (await get_file(file_id)).content_hash

if new_hash != old_hash:
    # File changed, reindex
    await reindex_file(file_id)
```

### Markdown with Frontmatter

```python
import yaml


def format_markdown_with_frontmatter(frontmatter: dict, content: str) -> str:
    """Format content with YAML frontmatter."""
    yaml_str = yaml.dump(frontmatter, default_flow_style=False, sort_keys=False)
    return f"---\n{yaml_str}---\n\n{content}"


def parse_markdown_with_frontmatter(markdown: str) -> tuple[dict, str]:
    """Parse markdown file with YAML frontmatter."""
    if not markdown.startswith("---\n"):
        return {}, markdown

    end_idx = markdown.find("\n---\n", 4)
    if end_idx == -1:
        return {}, markdown

    yaml_str = markdown[4:end_idx]
    content = markdown[end_idx + 5:].lstrip("\n")

    frontmatter = yaml.safe_load(yaml_str) or {}
    return frontmatter, content
```

### Embeddings with Qwen3

```python
from sentence_transformers import SentenceTransformer


class Embedder:
    """Generate embeddings using Qwen3-Embedding-0.6B."""

    def __init__(self):
        self.model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B")
        self.query_prefix = (
            "Instruct: Retrieve relevant code, documentation, or conversation\n"
            "Query: "
        )

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed documents (no instruction prefix needed)."""
        return self.model.encode(texts, normalize_embeddings=True).tolist()

    def embed_query(self, query: str) -> list[float]:
        """Embed a search query (with instruction prefix)."""
        text = self.query_prefix + query
        return self.model.encode(text, normalize_embeddings=True).tolist()
```

## What to Do

### Good Practices

- **Read existing code** before implementing new features
- **Write tests** for each new function/endpoint (use pytest)
- **Update documentation** when changing APIs or architecture
- **Use existing patterns** (follow established conventions)
- **Commit atomic changes** (one feature/fix per commit)
- **Add docstrings** for public functions and classes
- **Validate inputs** from users and external APIs
- **Handle errors gracefully** with clear messages
- **Log important operations** with context (use structlog or logging)
- **Use type hints** for all function signatures

### Example Test Pattern

```python
# server/tests/test_something.py
import pytest
from db import init_db, close_db
from db.projects import create_project, delete_project


@pytest.fixture
async def db_pool():
    """Initialize database for tests."""
    pool = await init_db()
    yield pool
    await close_db()


@pytest.fixture
async def test_project(db_pool):
    """Create a test project."""
    project = await create_project("Test Project", "Testing")
    yield project
    await delete_project(project.id)


async def test_basic_operation(test_project):
    """Test basic operation works."""
    result = await some_function(test_project.id)
    assert result.success is True


async def test_edge_case(test_project):
    """Test edge case handling."""
    with pytest.raises(ValueError, match="invalid"):
        await some_function(test_project.id, invalid_param=True)
```

## What NOT to Do

### Anti-Patterns

- **Don't store file content in database** - Use filesystem
- **Don't store conversation content in database** - Use .md files
- **Don't use Docker for sandboxing** - Use bubblewrap (lighter, faster)
- **Don't install system-wide packages in sandbox** - Install in project directory (.venv, .pyenv, node_modules)
- **Don't duplicate data** - Single source of truth (files or DB, not both)
- **Don't expose API keys** to browser
- **Don't trust user input** - Validate and sanitize
- **Don't use synchronous I/O** - Use async (aiofiles, asyncpg)
- **Don't forget connection pooling** - Always use asyncpg pools
- **Don't commit .env** or /srv/projects/ data

## Testing

### Running Tests

```bash
# Install test dependencies
pip install pytest pytest-asyncio httpx

# Run all tests
pytest server/tests/

# Run specific test file
pytest server/tests/test_schema.py

# Run with verbose output
pytest -v server/tests/

# Run with coverage
pytest --cov=server server/tests/

# Manual API testing
curl -X POST http://localhost:8000/api/turn \
  -H "Content-Type: application/json" \
  -d '{"userMessage": "Hello", "targetModels": [{"provider": "openai", "modelId": "gpt-4o"}]}' \
  | jq
```

### What to Test

- **Database operations** - Can create/read/update/delete
- **File operations** - Can upload/read/delete files
- **Conversation operations** - Can create conversations, save messages
- **Search** - Can index and search files and conversations
- **Execution** - Can run bash commands in bubblewrap sandbox
- **End-to-end** - Full workflow from user message to model response

## Bubblewrap Sandbox

### Prerequisites (Linux)

```bash
# Fedora
sudo dnf install bubblewrap

# Ubuntu/Debian
sudo apt install bubblewrap

# Verify installation
bwrap --version
```

### Testing Execution

```bash
# Test sandbox manually
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /bin /bin \
  --bind /srv/projects/test-project/workspace /workspace \
  --tmpfs /tmp \
  --proc /proc \
  --dev /dev \
  --unshare-all \
  --share-net \
  --die-with-parent \
  --chdir /workspace \
  bash -c "python3 -m venv .venv && source .venv/bin/activate && pip install pandas && python -c 'import pandas; print(pandas.__version__)'"
```

## Debugging

### Common Issues

**"ModuleNotFoundError"**
→ Run `pip install -r requirements.txt`

**"Database connection refused"**
→ Ensure Postgres is running: `systemctl status postgresql`

**"bwrap: command not found"**
→ Install bubblewrap: `sudo dnf install bubblewrap` (Fedora) or `sudo apt install bubblewrap` (Debian/Ubuntu)

**"Permission denied" accessing /srv/projects/**
→ Check file permissions: `sudo chown -R $USER /srv/projects`

**"asyncpg.exceptions.TooManyConnectionsError"**
→ Check pool configuration, ensure connections are being released

### Debug Logging

```python
import logging

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

logger = logging.getLogger(__name__)

# Usage
logger.debug(f"Executing command: {command}")
logger.info(f"Created project: {project_id}")
logger.error(f"Failed to save file: {e}")
```

Run with: `DEBUG=true python -m server.main`

## Getting Help

### Documentation to Read

1. **This project:**
   - [VISION.md](VISION.md) - Goals and principles
   - [ARCHITECTURE.md](ARCHITECTURE.md) - Technical design
   - [ROADMAP.md](ROADMAP.md) - Implementation plan
   - Per-project specs in `mm-server/specs/`, `mm-search/specs/`, `mm-web/specs/`

2. **External:**
   - [FastAPI docs](https://fastapi.tiangolo.com/)
   - [asyncpg docs](https://magicstack.github.io/asyncpg/)
   - [PostgreSQL docs](https://www.postgresql.org/docs/)
   - [pgvector docs](https://github.com/pgvector/pgvector)
   - [Bubblewrap docs](https://github.com/containers/bubblewrap)
   - [sentence-transformers docs](https://www.sbert.net/)

### Useful Commands

```bash
# Check database schema
psql -d multimodelchat -c "\d"

# Query database
psql -d multimodelchat -c "SELECT * FROM projects"

# Check if Postgres is running
systemctl status postgresql

# Check bubblewrap version
bwrap --version

# View project files
ls -la /srv/projects/*/workspace/

# Search project files
grep -r "search term" /srv/projects/*/workspace/

# Check file size
du -sh /srv/projects/*/

# Monitor inotify watches
cat /proc/sys/fs/inotify/max_user_watches
```

## Implementation Priority

When implementing from scratch, follow the [ROADMAP.md](ROADMAP.md) order:

1. **Step 01** - Database schema (Postgres + pgvector foundation)
2. **Step 02** - File storage (needed for execution)
3. **Step 03** - Conversations (needed for /api/turn)
4. **Step 04** - Bubblewrap execution (needed for tools)
5. **Step 05** - Tool integration (core feature)
6. **Step 06** - Search (Postgres FTS + pgvector + Qwen3 embeddings)
7. **Step 07** - System prompts (polish)
8. **Step 08** - UI (user experience)

**Specs are distributed to projects:**
- mm-server/specs/ - Steps 01-05, 07, 09
- mm-search/specs/ - Step 06
- mm-web/specs/ - Step 08

## Dependencies

### Python Requirements (requirements.txt)

```
# Web framework
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
python-multipart>=0.0.6

# Database
asyncpg>=0.29.0
python-dotenv>=1.0.0

# File handling
aiofiles>=23.2.0
pyyaml>=6.0.1

# AI/ML
openai>=1.12.0
anthropic>=0.18.0
sentence-transformers>=2.3.0

# Utilities
httpx>=0.26.0

# Testing
pytest>=8.0.0
pytest-asyncio>=0.23.0
```
