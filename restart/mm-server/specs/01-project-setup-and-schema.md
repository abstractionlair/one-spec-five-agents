# Step 01: Project Setup & Postgres Schema

**Goal:** Set up the database schema, migrations system, and basic project/config management.

**Complexity:** Low-Medium (3-4 hours)

**Dependencies:** None (first step)

## Prerequisites

- Postgres installed and running on Fedora host
- pgvector extension installed (`dnf install pgvector`)
- Database created: `createdb multimodelchat`
- Python 3.12+ with asyncpg: `pip install asyncpg`

## Overview

This step establishes the data layer foundation. We'll create:
1. Postgres database with all tables
2. pgvector extension enabled for future embedding storage
3. Migration system for schema evolution
4. Basic CRUD operations for projects and config
5. Test script to verify everything works

## Database Schema

### Tables

#### projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings JSONB DEFAULT '{}',    -- Sandbox config, volumes, model prefs, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes:**
- `settings` stores JSON like:
  ```json
  {
    "allow_network": true,
    "additional_volumes": [...],
    "model_config": {
      "temperature": 0.7,
      "max_tokens": 4096,
      "top_p": 1.0
    }
  }
  ```
- `id` uses format: `proj_<timestamp>_<random>`

#### project_files
```sql
CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,             -- Relative path: "data/sales.csv"
  content_hash TEXT,              -- SHA256 for change detection
  mime_type TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, path)
);

CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_files_path ON project_files(path);
```

**Notes:**
- NO `content` column (files live on filesystem)
- `content_hash` used to detect changes for re-indexing
- `path` is relative to `/srv/projects/{project-id}/workspace/`

#### conversations
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',    -- Summaries, preferences, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
```

**Notes:**
- `settings` stores conversation-specific metadata like summaries:
  ```json
  {
    "summary": {
      "upToRound": 10,
      "content": "Summary text...",
      "createdAt": "2025-01-15T10:30:00Z",
      "messageCount": 20
    }
  }
  ```

#### conversation_messages
```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,          -- "user" or "agent:<model-id>"
  file_path TEXT NOT NULL,        -- ".metadata/.conversations/conv-123/rounds/001-user.md"
  model_id TEXT,                  -- "gpt-5.1", "claude-opus-4-5", etc.
  provider TEXT,                  -- "openai", "anthropic", etc.
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX idx_messages_round ON conversation_messages(conversation_id, round_number);
```

**Notes:**
- NO `content` column (messages stored as .md files)
- `file_path` is relative to project directory
- Token counts for cost tracking

#### content_chunks
```sql
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,      -- "file" or "conversation_message"
  source_id TEXT NOT NULL,        -- ID of file or message
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER,            -- 0, 1, 2, ... for multi-chunk sources
  content TEXT NOT NULL,          -- The actual chunk content
  location JSONB,                 -- File path, line range, or round info
  token_count INTEGER,
  search_vector tsvector,         -- Postgres full-text search vector
  embedding vector(1024),         -- pgvector embedding (Qwen3-Embedding-0.6B: 1024 dimensions)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chunks_source ON content_chunks(source_type, source_id);
CREATE INDEX idx_chunks_project ON content_chunks(project_id);
CREATE INDEX idx_chunks_search ON content_chunks USING GIN(search_vector);
CREATE INDEX idx_chunks_embedding ON content_chunks USING ivfflat(embedding vector_cosine_ops);
```

**Notes:**
- `search_vector` is Postgres tsvector for full-text search
- `embedding` stores 1024-dimensional vectors (Qwen3-Embedding-0.6B output dimension)
- GIN index for fast full-text search
- IVFFlat index for approximate nearest neighbor on embeddings

#### config
```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes:**
- Store app-wide settings (system prompts, defaults, etc.)
- Values are JSONB for native JSON operations

## File Structure

```
server/
  db/
    __init__.py        # Package exports
    connection.py      # Database connection pool
    schema.sql         # Complete schema definition
    migrations.py      # Migration system
    projects.py        # CRUD for projects
    config.py          # CRUD for config
  tests/
    test_schema.py     # Test script
```

## Implementation

### 1. Database Connection (server/db/connection.py)

```python
"""Database connection pool management using asyncpg."""

import os
import asyncpg
from typing import Any
from contextlib import asynccontextmanager

# Global connection pool
_pool: asyncpg.Pool | None = None


async def init_db() -> asyncpg.Pool:
    """Initialize the database connection pool."""
    global _pool

    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql://localhost/multimodelchat"
    )

    _pool = await asyncpg.create_pool(
        database_url,
        min_size=2,
        max_size=20,
        command_timeout=60
    )

    return _pool


async def get_pool() -> asyncpg.Pool:
    """Get the connection pool, initializing if needed."""
    global _pool
    if _pool is None:
        await init_db()
    return _pool


async def close_db() -> None:
    """Close the connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def query(sql: str, *args: Any) -> list[asyncpg.Record]:
    """Execute a query and return all results."""
    pool = await get_pool()
    return await pool.fetch(sql, *args)


async def query_one(sql: str, *args: Any) -> asyncpg.Record | None:
    """Execute a query and return the first result."""
    pool = await get_pool()
    return await pool.fetchrow(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    """Execute a statement and return status."""
    pool = await get_pool()
    return await pool.execute(sql, *args)


@asynccontextmanager
async def transaction():
    """Context manager for database transactions."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            yield conn
```

### 2. Schema (server/db/schema.sql)

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Project files metadata (content lives on filesystem)
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_hash TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_path ON project_files(path);

-- Conversations metadata (messages live on filesystem as .md files)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

-- Conversation messages metadata (content lives in .md files)
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  file_path TEXT NOT NULL,
  model_id TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_round ON conversation_messages(conversation_id, round_number);

-- Content chunks for search indexing
CREATE TABLE IF NOT EXISTS content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER,
  content TEXT NOT NULL,
  location JSONB,
  token_count INTEGER,
  search_vector tsvector,
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_source ON content_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON content_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_search ON content_chunks USING GIN(search_vector);

-- App-wide configuration
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating timestamps
DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS project_files_updated_at ON project_files;
CREATE TRIGGER project_files_updated_at
  BEFORE UPDATE ON project_files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS conversations_updated_at ON conversations;
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS config_updated_at ON config;
CREATE TRIGGER config_updated_at
  BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 3. Migrations (server/db/migrations.py)

```python
"""Database migration system."""

import os
from pathlib import Path
from . import connection


async def get_current_version() -> int:
    """Get the current schema version from config."""
    try:
        row = await connection.query_one(
            "SELECT value FROM config WHERE key = $1",
            "schema_version"
        )
        return row["value"] if row else 0
    except Exception:
        # Table doesn't exist yet
        return 0


async def set_version(version: int) -> None:
    """Update the schema version in config."""
    await connection.execute("""
        INSERT INTO config (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    """, "schema_version", version)


async def run_migrations() -> None:
    """Run all pending migrations."""
    current_version = await get_current_version()
    print(f"Current schema version: {current_version}")

    # Migration 1: Initial schema
    if current_version < 1:
        print("Running migration 1: Initial schema...")

        schema_path = Path(__file__).parent / "schema.sql"
        schema_sql = schema_path.read_text()

        # Execute schema (may contain multiple statements)
        pool = await connection.get_pool()
        async with pool.acquire() as conn:
            await conn.execute(schema_sql)

        await set_version(1)
        print("  Migration 1 complete")

    # Migration 2: Add IVFFlat index for embeddings
    if current_version < 2:
        print("Running migration 2: Add embedding index...")

        # IVFFlat requires data to build index, create conditionally
        result = await connection.query_one(
            "SELECT COUNT(*) as count FROM content_chunks WHERE embedding IS NOT NULL"
        )

        if result and result["count"] > 100:
            await connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_chunks_embedding
                ON content_chunks USING ivfflat(embedding vector_cosine_ops)
                WITH (lists = 100)
            """)

        await set_version(2)
        print("  Migration 2 complete")

    print("All migrations complete")
```

### 4. Project CRUD (server/db/projects.py)

```python
"""CRUD operations for projects."""

import json
import time
import secrets
from typing import Any
from dataclasses import dataclass, field
from datetime import datetime

from . import connection


def new_id(prefix: str = "item") -> str:
    """Generate a unique ID with prefix."""
    timestamp = int(time.time() * 1000)
    random_part = secrets.token_hex(3)
    return f"{prefix}_{timestamp:x}_{random_part}"


@dataclass
class Project:
    """Project data model."""
    id: str
    name: str
    description: str | None
    settings: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_record(cls, record) -> "Project":
        """Create Project from database record."""
        return cls(
            id=record["id"],
            name=record["name"],
            description=record["description"],
            settings=json.loads(record["settings"]) if isinstance(record["settings"], str) else record["settings"],
            created_at=record["created_at"],
            updated_at=record["updated_at"]
        )


async def create_project(
    name: str,
    description: str = "",
    settings: dict[str, Any] | None = None
) -> Project:
    """Create a new project."""
    project_id = new_id("proj")
    settings = settings or {}

    await connection.execute("""
        INSERT INTO projects (id, name, description, settings)
        VALUES ($1, $2, $3, $4)
    """, project_id, name, description, json.dumps(settings))

    project = await get_project(project_id)
    if not project:
        raise RuntimeError("Failed to create project")
    return project


async def get_project(project_id: str) -> Project | None:
    """Get a project by ID."""
    row = await connection.query_one(
        "SELECT * FROM projects WHERE id = $1",
        project_id
    )

    if not row:
        return None
    return Project.from_record(row)


async def list_projects() -> list[Project]:
    """List all projects, most recently updated first."""
    rows = await connection.query(
        "SELECT * FROM projects ORDER BY updated_at DESC"
    )
    return [Project.from_record(row) for row in rows]


async def update_project(
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    settings: dict[str, Any] | None = None
) -> Project:
    """Update a project."""
    project = await get_project(project_id)
    if not project:
        raise ValueError("Project not found")

    await connection.execute("""
        UPDATE projects
        SET name = COALESCE($1, name),
            description = COALESCE($2, description),
            settings = COALESCE($3, settings)
        WHERE id = $4
    """,
        name,
        description,
        json.dumps(settings) if settings else None,
        project_id
    )

    updated = await get_project(project_id)
    if not updated:
        raise RuntimeError("Failed to retrieve updated project")
    return updated


async def delete_project(project_id: str) -> bool:
    """Delete a project. Returns True if deleted."""
    result = await connection.execute(
        "DELETE FROM projects WHERE id = $1",
        project_id
    )
    # Result is like "DELETE 1" or "DELETE 0"
    return result.endswith("1")
```

### 5. Config CRUD (server/db/config.py)

```python
"""CRUD operations for app configuration."""

import json
from typing import Any
from . import connection


async def get_config(key: str) -> Any:
    """Get a config value by key."""
    row = await connection.query_one(
        "SELECT value FROM config WHERE key = $1",
        key
    )

    if not row:
        return None

    value = row["value"]
    return json.loads(value) if isinstance(value, str) else value


async def set_config(key: str, value: Any) -> None:
    """Set a config value."""
    await connection.execute("""
        INSERT INTO config (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    """, key, json.dumps(value))


async def delete_config(key: str) -> bool:
    """Delete a config key. Returns True if deleted."""
    result = await connection.execute(
        "DELETE FROM config WHERE key = $1",
        key
    )
    return result.endswith("1")


async def list_config() -> dict[str, Any]:
    """Get all config as a dictionary."""
    rows = await connection.query("SELECT key, value FROM config")

    result = {}
    for row in rows:
        value = row["value"]
        result[row["key"]] = json.loads(value) if isinstance(value, str) else value
    return result
```

### 6. Package Init (server/db/__init__.py)

```python
"""Database package exports."""

from .connection import (
    init_db,
    get_pool,
    close_db,
    query,
    query_one,
    execute,
    transaction
)
from .migrations import run_migrations
from .projects import (
    new_id,
    Project,
    create_project,
    get_project,
    list_projects,
    update_project,
    delete_project
)
from .config import (
    get_config,
    set_config,
    delete_config,
    list_config
)

__all__ = [
    # Connection
    "init_db",
    "get_pool",
    "close_db",
    "query",
    "query_one",
    "execute",
    "transaction",
    # Migrations
    "run_migrations",
    # Projects
    "new_id",
    "Project",
    "create_project",
    "get_project",
    "list_projects",
    "update_project",
    "delete_project",
    # Config
    "get_config",
    "set_config",
    "delete_config",
    "list_config",
]
```

### 7. Test Script (server/tests/test_schema.py)

```python
"""Test database schema and CRUD operations."""

import asyncio
import sys
from pathlib import Path

# Add server to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import (
    init_db,
    close_db,
    query,
    query_one,
    execute,
    run_migrations,
    create_project,
    get_project,
    list_projects,
    update_project,
    delete_project,
    get_config,
    set_config,
    list_config,
    delete_config
)


async def run_tests():
    """Run all database tests."""
    print("=== Testing Database Schema ===\n")

    try:
        # Initialize database
        await init_db()

        # Run migrations
        print("1. Running migrations...")
        await run_migrations()
        print("   Migrations complete\n")

        # Verify pgvector extension
        print("2. Verifying pgvector extension...")
        result = await query_one(
            "SELECT extname FROM pg_extension WHERE extname = 'vector'"
        )
        if not result:
            raise RuntimeError("pgvector extension not installed")
        print("     pgvector extension enabled\n")

        # Test projects
        print("3. Testing project CRUD...")

        project = await create_project(
            "Test Project",
            "A test project",
            {"allow_network": True}
        )
        print(f"   Created project: {project.id}")

        retrieved = await get_project(project.id)
        if not retrieved:
            raise RuntimeError("Failed to retrieve project")
        print("     Can retrieve project")

        updated = await update_project(project.id, name="Updated Project")
        if updated.name != "Updated Project":
            raise RuntimeError("Failed to update project")
        print("     Can update project")

        projects = await list_projects()
        if len(projects) == 0:
            raise RuntimeError("No projects listed")
        print("     Can list projects")

        # Test config
        print("\n4. Testing config CRUD...")

        await set_config("test_key", {"value": "test"})
        print("     Can set config")

        config_value = await get_config("test_key")
        if not config_value or config_value.get("value") != "test":
            raise RuntimeError("Failed to retrieve config")
        print("     Can get config")

        all_config = await list_config()
        if "test_key" not in all_config:
            raise RuntimeError("Config not in list")
        print("     Can list config")

        await delete_config("test_key")
        if await get_config("test_key"):
            raise RuntimeError("Failed to delete config")
        print("     Can delete config")

        # Test foreign keys
        print("\n5. Testing foreign keys...")

        # Insert a file record
        await execute("""
            INSERT INTO project_files (id, project_id, path)
            VALUES ($1, $2, $3)
        """, "file_test", project.id, "test.txt")

        # Delete project should cascade
        await delete_project(project.id)

        file_result = await query_one(
            "SELECT * FROM project_files WHERE id = $1",
            "file_test"
        )

        if file_result:
            raise RuntimeError("Cascade delete failed")
        print("     Foreign key cascade works")

        # Test tsvector search
        print("\n6. Testing full-text search...")

        test_proj = await create_project("FTS Test", "Testing full-text search")

        await execute("""
            INSERT INTO content_chunks
            (id, source_type, source_id, project_id, chunk_index, content, search_vector)
            VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('english', $6))
        """, "chunk_test", "file", "file_test2", test_proj.id, 0,
            "authentication flow using JWT tokens")

        search_result = await query("""
            SELECT id, ts_rank(search_vector, query) as rank
            FROM content_chunks, to_tsquery('english', $1) query
            WHERE search_vector @@ query AND project_id = $2
        """, "authentication", test_proj.id)

        if len(search_result) == 0:
            raise RuntimeError("Full-text search failed")
        print("     Full-text search works")

        # Cleanup
        await delete_project(test_proj.id)

        print("\n All tests passed!")

    except Exception as err:
        print(f"\n Test failed: {err}")
        sys.exit(1)
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(run_tests())
```

## Environment Setup

Create a `.env` file:
```bash
DATABASE_URL=postgresql://localhost/multimodelchat
DEBUG=true
```

## Running

```bash
# Create database (if not exists)
createdb multimodelchat

# Install pgvector extension (requires superuser)
psql multimodelchat -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Install Python dependencies
pip install asyncpg python-dotenv

# Initialize database and run tests
python -m server.tests.test_schema
```

## Success Criteria

- [ ] Database created with Postgres
- [ ] pgvector extension enabled
- [ ] All tables exist with correct schema
- [ ] Can create and retrieve projects
- [ ] Can update and delete projects
- [ ] Can set and get config values
- [ ] Foreign key constraints work (cascade delete)
- [ ] Full-text search works (tsvector)
- [ ] Test script passes all checks

## Common Issues

**"Connection refused"**
→ Ensure Postgres is running: `sudo systemctl start postgresql`

**"Extension 'vector' not found"**
→ Install pgvector: `sudo dnf install pgvector` then restart Postgres

**"Permission denied for extension"**
→ Run as superuser: `sudo -u postgres psql -c "CREATE EXTENSION vector;" multimodelchat`

**"asyncpg.exceptions.TooManyConnectionsError"**
→ Increase max connections or check for connection leaks

## Next Steps

After this step completes:
- **Step 02:** Add filesystem storage for project files
- **Step 03:** Add conversation message storage as markdown files

---

**Previous:** [ROADMAP.md](../ROADMAP.md) | **Next:** [02-filesystem-storage.md](02-filesystem-storage.md)
