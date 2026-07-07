# Step 06: Unified Search (Postgres FTS + pgvector)

**Goal:** Index files and conversations for full-text and semantic search across all project content.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 02 (File storage), Step 03 (Conversations)

## Overview

Build a unified search system that indexes:
- Project files (code, docs, data)
- Conversation messages
- Auto-indexes on creation/update via inotify (watchdog)

Search returns ranked results from both sources using:
- **Postgres FTS (tsvector):** Fast keyword search with ranking
- **pgvector:** Semantic similarity search via Qwen3-Embedding-0.6B

## Embedding Model

We use **Qwen3-Embedding-0.6B** for local semantic embeddings:
- 0.6B parameters - runs efficiently on CPU
- 1024-dimensional output
- **Asymmetric search**: queries need instruction prefix, documents don't
- No API calls or rate limits

```python
# Install: pip install sentence-transformers torch
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B")

# For documents (no prefix)
doc_embeddings = model.encode(["document text here"], normalize_embeddings=True)

# For queries (with instruction prefix)
query_prefix = "Instruct: Retrieve relevant code, documentation, or conversation\nQuery: "
query_embedding = model.encode([query_prefix + "search query"], normalize_embeddings=True)
```

## Architecture

```
File Created/Updated (detected by watchdog)
       │
       ▼
  ┌─────────┐
  │ Chunker │ Split into ~500 token chunks
  └────┬────┘
       │
       ▼
  ┌──────────┐
  │ Embedder │ Qwen3-Embedding-0.6B (1024 dims)
  └────┬─────┘
       │
       ▼
  ┌──────────┐
  │ Indexer  │ Insert into content_chunks + tsvector + embedding
  └──────────┘

Search Query
       │
       ▼
  ┌─────────────┐
  │ Postgres    │ Hybrid: FTS (ts_rank) + vector similarity
  │ FTS+pgvector│
  └──────┬──────┘
         │
         ▼
  Results (files + conversations, ranked)
```

## File Structure

```
server/
  indexing/
    __init__.py
    chunker.py     # Split content into chunks
    embedder.py    # Qwen3-Embedding-0.6B wrapper
    indexer.py     # Index chunks in Postgres
    search.py      # Search API

indexer/
  __init__.py
  main.py          # File watching daemon entry point
  watcher.py       # watchdog setup

server/
  tests/
    test_search.py # Integration tests
```

## Implementation

### 1. Chunker (server/indexing/chunker.py)

```python
"""Text chunking utilities for search indexing."""

from dataclasses import dataclass


@dataclass
class Chunk:
    """A chunk of text content."""
    content: str
    token_count: int
    start_line: int | None = None
    end_line: int | None = None


def estimate_tokens(text: str) -> int:
    """
    Estimate tokens in text (rough approximation).
    ~4 characters per token for English.
    """
    return (len(text) + 3) // 4


def chunk_text(text: str, max_tokens: int = 500) -> list[Chunk]:
    """
    Split text into chunks of ~max_tokens.
    Tries to split on natural boundaries (lines).
    """
    lines = text.split("\n")
    chunks: list[Chunk] = []
    current_chunk: list[str] = []
    current_tokens = 0

    for line in lines:
        line_tokens = estimate_tokens(line)

        if current_tokens + line_tokens > max_tokens and current_chunk:
            # Chunk is full, save it
            chunks.append(Chunk(
                content="\n".join(current_chunk),
                token_count=current_tokens
            ))
            current_chunk = [line]
            current_tokens = line_tokens
        else:
            current_chunk.append(line)
            current_tokens += line_tokens

    # Save remaining
    if current_chunk:
        chunks.append(Chunk(
            content="\n".join(current_chunk),
            token_count=current_tokens
        ))

    return chunks


def chunk_by_lines(text: str, lines_per_chunk: int = 50) -> list[Chunk]:
    """
    Split content by lines for line-based results.
    """
    lines = text.split("\n")
    chunks: list[Chunk] = []

    for i in range(0, len(lines), lines_per_chunk):
        chunk_lines = lines[i:i + lines_per_chunk]
        content = "\n".join(chunk_lines)
        chunks.append(Chunk(
            content=content,
            start_line=i + 1,
            end_line=i + len(chunk_lines),
            token_count=estimate_tokens(content)
        ))

    return chunks
```

### 2. Embedder (server/indexing/embedder.py)

```python
"""Qwen3-Embedding-0.6B wrapper for semantic search."""

import logging
from functools import lru_cache

from sentence_transformers import SentenceTransformer


logger = logging.getLogger(__name__)

# Query instruction for asymmetric search
QUERY_INSTRUCTION = "Instruct: Retrieve relevant code, documentation, or conversation\nQuery: "


class Embedder:
    """
    Wrapper for Qwen3-Embedding-0.6B model.

    Uses asymmetric embedding:
    - Documents are embedded without prefix
    - Queries are prefixed with retrieval instruction
    """

    def __init__(self, model_name: str = "Qwen/Qwen3-Embedding-0.6B"):
        logger.info(f"Loading embedding model: {model_name}")
        self.model = SentenceTransformer(model_name)
        self.dimension = 1024  # Qwen3-Embedding-0.6B output dimension

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Embed documents (no instruction prefix).

        Args:
            texts: List of document texts to embed

        Returns:
            List of 1024-dimensional embedding vectors
        """
        if not texts:
            return []

        embeddings = self.model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=len(texts) > 10
        )
        return embeddings.tolist()

    def embed_query(self, query: str) -> list[float]:
        """
        Embed a search query (with instruction prefix).

        Args:
            query: Search query text

        Returns:
            1024-dimensional embedding vector
        """
        text = QUERY_INSTRUCTION + query
        embedding = self.model.encode(
            text,
            normalize_embeddings=True
        )
        return embedding.tolist()

    def embed_queries(self, queries: list[str]) -> list[list[float]]:
        """
        Embed multiple search queries (with instruction prefix).

        Args:
            queries: List of search query texts

        Returns:
            List of 1024-dimensional embedding vectors
        """
        if not queries:
            return []

        texts = [QUERY_INSTRUCTION + q for q in queries]
        embeddings = self.model.encode(
            texts,
            normalize_embeddings=True
        )
        return embeddings.tolist()


# Singleton embedder instance (lazy-loaded)
_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    """Get the singleton embedder instance."""
    global _embedder
    if _embedder is None:
        _embedder = Embedder()
    return _embedder
```

### 3. Indexer (server/indexing/indexer.py)

```python
"""Content indexing for full-text and semantic search."""

import json
import logging
from pathlib import Path
from typing import Any

import aiofiles

from db import get_pool
from db.projects import new_id
from files.storage import PROJECTS_ROOT
from indexing.chunker import chunk_by_lines, estimate_tokens
from indexing.embedder import get_embedder
from conversations.reader import parse_markdown


logger = logging.getLogger(__name__)


async def index_file(file_id: str) -> dict[str, Any]:
    """
    Index a project file for search.

    Args:
        file_id: ID of file to index

    Returns:
        dict with indexed=True and file_id
    """
    pool = await get_pool()

    # Get file metadata
    row = await pool.fetchrow(
        "SELECT * FROM project_files WHERE id = $1",
        file_id
    )
    if not row:
        raise ValueError(f"File not found: {file_id}")

    # Read content
    project_path = PROJECTS_ROOT / row["project_id"] / "workspace"
    full_path = project_path / row["path"]

    async with aiofiles.open(full_path, "r", encoding="utf-8") as f:
        content = await f.read()

    # Chunk content
    chunks = chunk_by_lines(content, lines_per_chunk=50)

    # Generate embeddings for all chunks
    embedder = get_embedder()
    chunk_texts = [c.content for c in chunks]
    embeddings = embedder.embed_documents(chunk_texts)

    # Delete existing chunks and insert new ones in transaction
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM content_chunks WHERE source_type = $1 AND source_id = $2",
                "file", file_id
            )

            for i, chunk in enumerate(chunks):
                chunk_id = new_id("chunk")
                location = json.dumps({
                    "file_path": row["path"],
                    "start_line": chunk.start_line,
                    "end_line": chunk.end_line,
                    "mime_type": row["mime_type"]
                })

                await conn.execute("""
                    INSERT INTO content_chunks (
                        id, source_type, source_id, project_id, chunk_index,
                        content, location, token_count, search_vector, embedding
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8,
                        to_tsvector('english', $6), $9::vector
                    )
                """,
                    chunk_id,
                    "file",
                    file_id,
                    row["project_id"],
                    i,
                    chunk.content,
                    location,
                    chunk.token_count,
                    json.dumps(embeddings[i])
                )

    logger.info(f"Indexed file {file_id}: {len(chunks)} chunks")
    return {"indexed": True, "file_id": file_id}


async def index_message(message_id: str) -> dict[str, Any]:
    """
    Index a conversation message for search.

    Args:
        message_id: ID of message to index

    Returns:
        dict with indexed=True and message_id
    """
    pool = await get_pool()

    # Get message metadata
    msg_row = await pool.fetchrow(
        "SELECT * FROM conversation_messages WHERE id = $1",
        message_id
    )
    if not msg_row:
        raise ValueError(f"Message not found: {message_id}")

    # Get conversation to find project
    conv_row = await pool.fetchrow(
        "SELECT project_id FROM conversations WHERE id = $1",
        msg_row["conversation_id"]
    )

    # Read message file
    project_path = PROJECTS_ROOT / conv_row["project_id"]
    full_path = project_path / msg_row["file_path"]

    async with aiofiles.open(full_path, "r", encoding="utf-8") as f:
        markdown = await f.read()

    _, content = parse_markdown(markdown)

    # Generate embedding
    embedder = get_embedder()
    embedding = embedder.embed_documents([content])[0]

    # Delete existing chunk and insert new
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM content_chunks WHERE source_type = $1 AND source_id = $2",
                "conversation_message", message_id
            )

            chunk_id = new_id("chunk")
            token_count = estimate_tokens(content)
            location = json.dumps({
                "conversation_id": msg_row["conversation_id"],
                "round": msg_row["round_number"],
                "speaker": msg_row["speaker"],
                "model": msg_row["model_id"]
            })

            await conn.execute("""
                INSERT INTO content_chunks (
                    id, source_type, source_id, project_id, chunk_index,
                    content, location, token_count, search_vector, embedding
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8,
                    to_tsvector('english', $6), $9::vector
                )
            """,
                chunk_id,
                "conversation_message",
                message_id,
                conv_row["project_id"],
                0,
                content,
                location,
                token_count,
                json.dumps(embedding)
            )

    logger.info(f"Indexed message {message_id}")
    return {"indexed": True, "message_id": message_id}


async def reindex_project(project_id: str) -> int:
    """
    Re-index all files in a project.

    Args:
        project_id: Project ID to reindex

    Returns:
        Number of files indexed
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id FROM project_files WHERE project_id = $1",
        project_id
    )

    count = 0
    for row in rows:
        await index_file(row["id"])
        count += 1

    logger.info(f"Reindexed project {project_id}: {count} files")
    return count


async def delete_file_index(file_id: str) -> None:
    """Delete index entries for a file."""
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM content_chunks WHERE source_type = $1 AND source_id = $2",
        "file", file_id
    )


async def delete_message_index(message_id: str) -> None:
    """Delete index entries for a message."""
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM content_chunks WHERE source_type = $1 AND source_id = $2",
        "conversation_message", message_id
    )
```

### 4. Search (server/indexing/search.py)

```python
"""Search API with full-text and semantic search."""

import json
import re
from dataclasses import dataclass
from typing import Any

from db import get_pool
from indexing.embedder import get_embedder


@dataclass
class SearchResult:
    """A search result."""
    id: str
    rank: float
    snippet: str | None
    type: str  # 'file' or 'conversation'
    source_id: str
    token_count: int
    # File-specific
    file_path: str | None = None
    start_line: int | None = None
    end_line: int | None = None
    mime_type: str | None = None
    # Conversation-specific
    conversation_id: str | None = None
    round: int | None = None
    speaker: str | None = None
    model: str | None = None
    # For hybrid search
    similarity: float | None = None
    combined_score: float | None = None


def to_tsquery(user_query: str) -> str | None:
    """
    Convert user query to tsquery format.
    Handles multi-word queries by connecting with &.
    """
    # Split on whitespace and filter empty strings
    words = user_query.strip().split()
    words = [w for w in words if w]

    if not words:
        return None

    # Remove non-word characters and connect with & (AND)
    clean_words = [re.sub(r"[^\w]", "", w) for w in words]
    clean_words = [w for w in clean_words if w]

    if not clean_words:
        return None

    return " & ".join(clean_words)


async def search(
    project_id: str,
    user_query: str,
    limit: int = 10,
    include_files: bool = True,
    include_conversations: bool = True,
    file_types: list[str] | None = None
) -> list[SearchResult]:
    """
    Search across files and conversations using Postgres FTS.

    Args:
        project_id: Project to search in
        user_query: Search query string
        limit: Maximum results to return
        include_files: Include file results
        include_conversations: Include conversation results
        file_types: Filter to specific file extensions (e.g., ['.py', '.md'])

    Returns:
        List of SearchResult objects ranked by relevance
    """
    ts_query = to_tsquery(user_query)
    if not ts_query:
        return []

    # Determine which source types to include
    allowed_types = []
    if include_files:
        allowed_types.append("file")
    if include_conversations:
        allowed_types.append("conversation_message")

    if not allowed_types:
        return []

    pool = await get_pool()

    # Build query with ts_rank for relevance scoring
    sql = """
        SELECT
            id,
            source_type,
            source_id,
            content,
            location,
            token_count,
            ts_rank(search_vector, to_tsquery('english', $1)) as rank,
            ts_headline('english', content, to_tsquery('english', $1),
                'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
            ) as snippet
        FROM content_chunks
        WHERE search_vector @@ to_tsquery('english', $1)
            AND project_id = $2
            AND source_type = ANY($3)
    """
    params = [ts_query, project_id, allowed_types]

    # Filter by file types
    if file_types and include_files:
        extensions = [t if t.startswith(".") else f".{t}" for t in file_types]
        type_conditions = " OR ".join(
            f"location->>'file_path' LIKE $" + str(i + 4)
            for i in range(len(extensions))
        )
        sql += f"""
            AND (
                source_type != 'file'
                OR ({type_conditions})
            )
        """
        params.extend([f"%{ext}" for ext in extensions])

    sql += f" ORDER BY rank DESC LIMIT ${len(params) + 1}"
    params.append(limit)

    rows = await pool.fetch(sql, *params)

    # Format results
    results = []
    for row in rows:
        location = row["location"]  # Already parsed as dict by asyncpg
        result_type = "file" if row["source_type"] == "file" else "conversation"

        result = SearchResult(
            id=row["id"],
            rank=row["rank"],
            snippet=row["snippet"],
            type=result_type,
            source_id=row["source_id"],
            token_count=row["token_count"]
        )

        if result_type == "file":
            result.file_path = location.get("file_path")
            result.start_line = location.get("start_line")
            result.end_line = location.get("end_line")
            result.mime_type = location.get("mime_type")
        else:
            result.conversation_id = location.get("conversation_id")
            result.round = location.get("round")
            result.speaker = location.get("speaker")
            result.model = location.get("model")

        results.append(result)

    return results


async def semantic_search(
    project_id: str,
    embedding: list[float],
    limit: int = 10
) -> list[SearchResult]:
    """
    Semantic search using pgvector.

    Args:
        project_id: Project to search in
        embedding: Query embedding vector (1024 dims)
        limit: Maximum results to return

    Returns:
        List of SearchResult objects ranked by similarity
    """
    pool = await get_pool()

    rows = await pool.fetch("""
        SELECT
            id,
            source_type,
            source_id,
            content,
            location,
            token_count,
            1 - (embedding <=> $1::vector) as similarity
        FROM content_chunks
        WHERE project_id = $2
            AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3
    """, json.dumps(embedding), project_id, limit)

    results = []
    for row in rows:
        location = row["location"]
        result_type = "file" if row["source_type"] == "file" else "conversation"

        result = SearchResult(
            id=row["id"],
            rank=0.0,
            snippet=None,
            type=result_type,
            source_id=row["source_id"],
            token_count=row["token_count"],
            similarity=row["similarity"]
        )

        if result_type == "file":
            result.file_path = location.get("file_path")
            result.start_line = location.get("start_line")
            result.end_line = location.get("end_line")
            result.mime_type = location.get("mime_type")
        else:
            result.conversation_id = location.get("conversation_id")
            result.round = location.get("round")
            result.speaker = location.get("speaker")
            result.model = location.get("model")

        results.append(result)

    return results


async def hybrid_search(
    project_id: str,
    user_query: str,
    limit: int = 10,
    fts_weight: float = 0.5,
    semantic_weight: float = 0.5,
    **kwargs
) -> list[SearchResult]:
    """
    Hybrid search combining FTS and semantic results.

    Args:
        project_id: Project to search in
        user_query: Search query string
        limit: Maximum results to return
        fts_weight: Weight for FTS scores (0-1)
        semantic_weight: Weight for semantic scores (0-1)
        **kwargs: Additional options passed to FTS search

    Returns:
        List of SearchResult objects with combined scores
    """
    # Get FTS results
    fts_results = await search(project_id, user_query, limit=limit * 2, **kwargs)

    # Generate query embedding
    embedder = get_embedder()
    query_embedding = embedder.embed_query(user_query)

    # Get semantic results
    semantic_results = await semantic_search(project_id, query_embedding, limit=limit * 2)

    # Merge and re-rank
    score_map: dict[str, SearchResult] = {}

    # Normalize FTS scores
    max_fts = max((r.rank for r in fts_results), default=0.001)
    for r in fts_results:
        r.combined_score = (r.rank / max_fts) * fts_weight
        score_map[r.id] = r

    # Add semantic scores
    for r in semantic_results:
        existing = score_map.get(r.id)
        if existing:
            existing.combined_score = (existing.combined_score or 0) + (r.similarity or 0) * semantic_weight
            existing.similarity = r.similarity
        else:
            r.combined_score = (r.similarity or 0) * semantic_weight
            score_map[r.id] = r

    # Sort by combined score and return top results
    results = sorted(
        score_map.values(),
        key=lambda x: x.combined_score or 0,
        reverse=True
    )

    return results[:limit]
```

### 5. File Watcher (indexer/watcher.py)

```python
"""File system watcher using watchdog for auto-indexing."""

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Callable

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

from db import get_pool
from indexing.indexer import index_file, delete_file_index


logger = logging.getLogger(__name__)

PROJECTS_ROOT = Path(os.getenv("PROJECTS_DIR", "/srv/projects"))

# Patterns to ignore
IGNORE_PATTERNS = [
    r"(^|/)\..*",           # Dotfiles
    r"node_modules",        # Node modules
    r"\.pyenv",             # pyenv
    r"\.venv",              # virtualenv
    r"__pycache__",         # Python cache
    r"\.git",               # Git
]


def should_ignore(path: str) -> bool:
    """Check if path matches ignore patterns."""
    for pattern in IGNORE_PATTERNS:
        if re.search(pattern, path):
            return True
    return False


def parse_file_path(full_path: str) -> tuple[str, str] | None:
    """
    Extract project ID and relative path from full path.

    Path format: /srv/projects/{project-id}/workspace/{relative-path}

    Returns:
        Tuple of (project_id, relative_path) or None if invalid
    """
    try:
        path = Path(full_path)
        relative = path.relative_to(PROJECTS_ROOT)
        parts = relative.parts

        if len(parts) < 3 or parts[1] != "workspace":
            return None

        project_id = parts[0]
        relative_path = "/".join(parts[2:])
        return (project_id, relative_path)
    except ValueError:
        return None


class IndexerEventHandler(FileSystemEventHandler):
    """
    Handle file system events for auto-indexing.

    Uses asyncio.run_coroutine_threadsafe to bridge watchdog's
    synchronous callbacks to async indexing functions.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__()
        self.loop = loop
        self._debounce_tasks: dict[str, asyncio.Task] = {}
        self._debounce_delay = 0.5  # seconds

    def _schedule_async(self, coro):
        """Schedule an async coroutine from sync context."""
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    async def _handle_file_change(self, path: str, is_delete: bool = False):
        """Handle file add/change/delete with debouncing."""
        parsed = parse_file_path(path)
        if not parsed:
            return

        project_id, relative_path = parsed

        if should_ignore(relative_path):
            return

        pool = await get_pool()

        try:
            # Find file record by project and path
            row = await pool.fetchrow(
                "SELECT id FROM project_files WHERE project_id = $1 AND path = $2",
                project_id, relative_path
            )

            if row:
                if is_delete:
                    await delete_file_index(row["id"])
                    logger.info(f"Removed from index: {relative_path}")
                else:
                    await index_file(row["id"])
                    logger.info(f"Indexed: {relative_path}")
        except Exception as err:
            action = "remove" if is_delete else "index"
            logger.error(f"Failed to {action} {relative_path}: {err}")

    async def _debounced_handler(self, path: str, is_delete: bool = False):
        """Debounce rapid file changes."""
        # Cancel any pending task for this path
        if path in self._debounce_tasks:
            self._debounce_tasks[path].cancel()

        # Wait for debounce delay
        await asyncio.sleep(self._debounce_delay)

        # Process the change
        await self._handle_file_change(path, is_delete)

        # Clean up
        self._debounce_tasks.pop(path, None)

    def on_created(self, event: FileSystemEvent):
        if event.is_directory:
            return
        logger.debug(f"File created: {event.src_path}")
        task = self._schedule_async(self._debounced_handler(event.src_path))

    def on_modified(self, event: FileSystemEvent):
        if event.is_directory:
            return
        logger.debug(f"File modified: {event.src_path}")
        task = self._schedule_async(self._debounced_handler(event.src_path))

    def on_deleted(self, event: FileSystemEvent):
        if event.is_directory:
            return
        logger.debug(f"File deleted: {event.src_path}")
        task = self._schedule_async(self._debounced_handler(event.src_path, is_delete=True))


def start_watcher(loop: asyncio.AbstractEventLoop) -> Observer:
    """
    Start watching project directories for file changes.

    Args:
        loop: The asyncio event loop for async callbacks

    Returns:
        The watchdog Observer instance
    """
    logger.info(f"Starting file watcher on {PROJECTS_ROOT}")

    event_handler = IndexerEventHandler(loop)
    observer = Observer()

    # Watch all project workspace directories
    watch_path = str(PROJECTS_ROOT)
    observer.schedule(event_handler, watch_path, recursive=True)
    observer.start()

    logger.info("File watcher started")
    return observer
```

### 6. Indexer Daemon (indexer/main.py)

```python
"""Indexer daemon entry point with file watching."""

import asyncio
import logging
import signal
import sys

from db import init_db, close_db
from indexer.watcher import start_watcher


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)


async def main():
    """Main entry point for indexer daemon."""
    logger.info("=== Indexer Daemon Starting ===")

    # Initialize database
    await init_db()

    # Get event loop for async callbacks
    loop = asyncio.get_running_loop()

    # Start file watcher
    observer = start_watcher(loop)

    # Set up graceful shutdown
    shutdown_event = asyncio.Event()

    def handle_signal(sig):
        logger.info(f"Received {sig.name}, shutting down...")
        shutdown_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda s=sig: handle_signal(s))

    logger.info("Indexer daemon running. Press Ctrl+C to stop.")

    # Wait for shutdown signal
    await shutdown_event.wait()

    # Cleanup
    logger.info("Stopping file watcher...")
    observer.stop()
    observer.join()

    logger.info("Closing database connection...")
    await close_db()

    logger.info("Shutdown complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
```

### 7. Update File Storage (server/files/storage.py)

Add auto-indexing to `create_file` and `update_file`:

```python
# Add import at top of file
from indexing.indexer import index_file

# In create_file function, after database insert:
async def create_file(
    project_id: str,
    file_path: str,
    content: bytes | str,
    mime_type: str | None = None
) -> ProjectFile:
    # ... existing code ...

    # Auto-index if text file
    if mime_type and (mime_type.startswith("text/") or mime_type == "application/json"):
        try:
            await index_file(file_id)
        except Exception as err:
            logger.error(f"Indexing error: {err}")
            # Don't fail file creation if indexing fails

    return await get_file(file_id)


# In update_file function, after database update:
async def update_file(file_id: str, content: bytes | str) -> ProjectFile:
    # ... existing code ...

    # Re-index
    try:
        await index_file(file_id)
    except Exception as err:
        logger.error(f"Reindexing error: {err}")

    return await get_file(file_id)
```

### 8. Update Conversation Writer (server/conversations/writer.py)

Add auto-indexing to `save_message`:

```python
# Add import at top of file
from indexing.indexer import index_message

# In save_message function, after database insert:
async def save_message(
    conversation_id: str,
    round_number: int,
    role: str,
    content: str,
    metadata: dict[str, Any] | None = None
) -> Message:
    # ... existing code ...

    # Auto-index message
    try:
        await index_message(message_id)
    except Exception as err:
        logger.error(f"Indexing error: {err}")

    return await get_message(message_id)
```

### 9. Search Route (server/indexing/routes.py)

```python
"""Search API routes."""

import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from indexing.search import search, hybrid_search, SearchResult


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["search"])


class SearchRequest(BaseModel):
    """Search request body."""
    query: str
    limit: int = 10
    include_files: bool = True
    include_conversations: bool = True
    file_types: list[str] | None = None
    use_semantic: bool = True  # Enable hybrid search by default


class SearchResultResponse(BaseModel):
    """Search result in response."""
    id: str
    rank: float
    snippet: str | None
    type: str
    source_id: str
    token_count: int
    file_path: str | None = None
    start_line: int | None = None
    end_line: int | None = None
    mime_type: str | None = None
    conversation_id: str | None = None
    round: int | None = None
    speaker: str | None = None
    model: str | None = None
    similarity: float | None = None
    combined_score: float | None = None


class SearchResponse(BaseModel):
    """Search response body."""
    results: list[SearchResultResponse]


@router.post("/search", response_model=SearchResponse)
async def search_project(project_id: str, request: SearchRequest) -> SearchResponse:
    """
    Search files and conversations in a project.

    Supports both keyword (FTS) and semantic search.
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    try:
        if request.use_semantic:
            results = await hybrid_search(
                project_id=project_id,
                user_query=request.query,
                limit=request.limit,
                include_files=request.include_files,
                include_conversations=request.include_conversations,
                file_types=request.file_types
            )
        else:
            results = await search(
                project_id=project_id,
                user_query=request.query,
                limit=request.limit,
                include_files=request.include_files,
                include_conversations=request.include_conversations,
                file_types=request.file_types
            )

        return SearchResponse(
            results=[SearchResultResponse(**asdict(r)) for r in results]
        )

    except Exception as err:
        logger.error(f"Search error: {err}")
        raise HTTPException(status_code=500, detail=str(err))
```

Add to main.py:
```python
# In server/main.py
from indexing.routes import router as search_router
app.include_router(search_router)
```

### 10. Integration Test (server/tests/test_search.py)

```python
"""Integration tests for search functionality."""

import asyncio
import shutil
import sys
from pathlib import Path

# Add server to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from db import init_db, close_db
from db.projects import create_project, delete_project
from files.storage import create_file, PROJECTS_ROOT
from conversations.writer import create_conversation, save_message
from indexing.search import search, hybrid_search, to_tsquery


@pytest.fixture
async def test_project():
    """Create and cleanup test project."""
    await init_db()

    project = await create_project("Search Test", "Testing search")
    yield project

    # Cleanup
    await delete_project(project.id)
    project_dir = PROJECTS_ROOT / project.id
    if project_dir.exists():
        shutil.rmtree(project_dir)

    await close_db()


@pytest.mark.asyncio
async def test_search_files(test_project):
    """Test searching indexed files."""
    # Create test file
    await create_file(
        test_project.id,
        "auth.py",
        b"def authenticate(user):\n    # Check credentials\n    return validate_token(user.token)",
        "text/x-python"
    )

    # Search for authentication
    results = await search(test_project.id, "authenticate")
    assert len(results) > 0
    assert results[0].type == "file"
    assert results[0].file_path == "auth.py"


@pytest.mark.asyncio
async def test_search_conversations(test_project):
    """Test searching indexed conversations."""
    # Create conversation with messages
    conv = await create_conversation(test_project.id, "Search Test Conv")
    await save_message(conv.id, 1, "user", "How does authentication work?", {})
    await save_message(
        conv.id, 1, "agent:gpt-4o",
        "Authentication works by validating JWT tokens.",
        {"model": "gpt-4o", "provider": "openai"}
    )

    # Search
    results = await search(test_project.id, "authentication")
    conv_results = [r for r in results if r.type == "conversation"]
    assert len(conv_results) > 0


@pytest.mark.asyncio
async def test_search_filter_by_type(test_project):
    """Test filtering search by source type."""
    await create_file(
        test_project.id,
        "test.txt",
        b"authentication module",
        "text/plain"
    )

    conv = await create_conversation(test_project.id, "Filter Test")
    await save_message(conv.id, 1, "user", "authentication question", {})

    # Files only
    file_results = await search(
        test_project.id, "authentication",
        include_files=True, include_conversations=False
    )
    assert all(r.type == "file" for r in file_results)

    # Conversations only
    conv_results = await search(
        test_project.id, "authentication",
        include_files=False, include_conversations=True
    )
    assert all(r.type == "conversation" for r in conv_results)


@pytest.mark.asyncio
async def test_hybrid_search(test_project):
    """Test hybrid FTS + semantic search."""
    await create_file(
        test_project.id,
        "readme.md",
        b"# User Authentication\n\nThis module handles login and session management.",
        "text/markdown"
    )

    # Hybrid search combines keyword and semantic
    results = await hybrid_search(test_project.id, "how to log in")
    assert len(results) > 0
    # Should have combined scores
    assert results[0].combined_score is not None


@pytest.mark.asyncio
async def test_snippets_highlighted(test_project):
    """Test that search snippets include highlighting."""
    await create_file(
        test_project.id,
        "test.txt",
        b"The authentication system validates tokens.",
        "text/plain"
    )

    results = await search(test_project.id, "authentication")
    assert len(results) > 0
    assert results[0].snippet is not None
    assert "<mark>" in results[0].snippet


def test_to_tsquery():
    """Test query conversion to tsquery format."""
    assert to_tsquery("hello world") == "hello & world"
    assert to_tsquery("single") == "single"
    assert to_tsquery("   spaces   ") == "spaces"
    assert to_tsquery("") is None


async def run_tests():
    """Run all search tests (standalone script mode)."""
    print("=== Testing Search ===\n")

    test_project = None

    try:
        await init_db()

        # Create test project
        print("1. Creating test project...")
        test_project = await create_project("Search Test", "Testing search")
        print(f"   Created project {test_project.id}\n")

        # Create test files
        print("2. Creating and indexing test files...")
        await create_file(
            test_project.id,
            "auth.py",
            b"def authenticate(user):\n    # Check credentials\n    return validate_token(user.token)",
            "text/x-python"
        )
        await create_file(
            test_project.id,
            "README.md",
            b"# Authentication\n\nThis module handles user authentication using JWT tokens.",
            "text/markdown"
        )
        print("   Created test files\n")

        # Create conversation with messages
        print("3. Creating and indexing conversation...")
        conv = await create_conversation(test_project.id, "Search Test Conv")
        await save_message(conv.id, 1, "user", "How does authentication work?", {})
        await save_message(
            conv.id, 1, "agent:gpt-4o",
            "Authentication works by validating JWT tokens.",
            {"model": "gpt-4o", "provider": "openai"}
        )
        print("   Created conversation with messages\n")

        # Search for "authentication"
        print("4. Searching for 'authentication'...")
        results1 = await search(test_project.id, "authentication")
        if not results1:
            raise RuntimeError("No results found")
        print(f"   Found {len(results1)} results:")
        for r in results1:
            loc = r.file_path or f"Round {r.round}"
            print(f"     - {r.type}: {loc} (rank: {r.rank:.4f})")
        print()

        # Search for "token"
        print("5. Searching for 'token'...")
        results2 = await search(test_project.id, "token")
        has_file = any(r.type == "file" for r in results2)
        has_conv = any(r.type == "conversation" for r in results2)
        if not has_file or not has_conv:
            raise RuntimeError("Should find results in both files and conversations")
        print("   Found results in both files and conversations\n")

        # Search files only
        print("6. Searching files only...")
        results3 = await search(
            test_project.id, "authentication",
            include_files=True, include_conversations=False
        )
        if any(r.type == "conversation" for r in results3):
            raise RuntimeError("Should not include conversations")
        print("   Filtered to files only\n")

        # Test snippets with highlighting
        print("7. Testing snippets with highlighting...")
        if not results1[0].snippet:
            raise RuntimeError("No snippet in results")
        if "<mark>" not in results1[0].snippet:
            raise RuntimeError("Snippet not highlighting matches")
        print("   Snippets work with <mark> highlighting\n")

        # Test hybrid search
        print("8. Testing hybrid search...")
        results4 = await hybrid_search(test_project.id, "how to authenticate users")
        if not results4:
            raise RuntimeError("Hybrid search should return results")
        if results4[0].combined_score is None:
            raise RuntimeError("Should have combined scores")
        print(f"   Hybrid search works (combined_score: {results4[0].combined_score:.4f})\n")

        # Test query conversion
        print("9. Testing query conversion...")
        tsq = to_tsquery("hello world")
        if tsq != "hello & world":
            raise RuntimeError(f"Expected 'hello & world', got '{tsq}'")
        print("   Query conversion works\n")

        print("✓ All search tests passed!")

    except Exception as err:
        print(f"\n✗ Test failed: {err}")
        sys.exit(1)
    finally:
        if test_project:
            await delete_project(test_project.id)
            project_dir = PROJECTS_ROOT / test_project.id
            if project_dir.exists():
                shutil.rmtree(project_dir)
        await close_db()


if __name__ == "__main__":
    asyncio.run(run_tests())
```

## Running

```bash
# Run search tests with pytest
pytest server/tests/test_search.py -v

# Or run standalone test script
python -m server.tests.test_search

# Start indexer daemon (separate terminal)
python -m indexer.main
```

## Success Criteria

- [ ] Qwen3-Embedding-0.6B model loads successfully
- [ ] Can index text files with embeddings automatically
- [ ] Can index conversation messages with embeddings automatically
- [ ] FTS search returns ranked results from files
- [ ] FTS search returns ranked results from conversations
- [ ] Semantic search returns results by embedding similarity
- [ ] Hybrid search combines FTS and semantic scores
- [ ] Snippets show matching context with `<mark>` highlights
- [ ] Can filter to files only or conversations only
- [ ] File watcher (watchdog) detects changes via inotify
- [ ] Test script passes

## Common Issues

**"No results found"**
→ Check files are being indexed (query `content_chunks` table)

**"search_vector is null"**
→ Ensure `to_tsvector()` is being called during insert

**"embedding is null"**
→ Check embedder is loading correctly, model is downloaded

**"Snippets not highlighted"**
→ Check `ts_headline()` is using correct start/stop selectors

**"Watcher not detecting changes"**
→ Check inotify limits: `cat /proc/sys/fs/inotify/max_user_watches`
→ Increase if needed: `sudo sysctl fs.inotify.max_user_watches=524288`

**"Pool connection timeout"**
→ Ensure indexer daemon isn't holding connections; use connection pool properly

**"Model loading slow"**
→ First load downloads model (~1.2GB). Subsequent loads are cached.

## Embedding Model Details

### Qwen3-Embedding-0.6B

- **Parameters:** 0.6B (runs efficiently on CPU)
- **Dimensions:** 1024
- **Context:** Up to 8192 tokens
- **Download:** ~1.2GB (cached in `~/.cache/huggingface/`)

```python
# Verify model is working
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B")

# Test embedding
text = "Hello, world!"
embedding = model.encode(text, normalize_embeddings=True)
print(f"Shape: {embedding.shape}")  # (1024,)
print(f"Normalized: {sum(embedding**2):.4f}")  # ~1.0
```

### Asymmetric Search

For retrieval tasks, Qwen3 uses asymmetric embedding:
- **Documents:** Embed without prefix
- **Queries:** Prefix with retrieval instruction

```python
# Our implementation in embedder.py
QUERY_INSTRUCTION = "Instruct: Retrieve relevant code, documentation, or conversation\nQuery: "

# Document embedding (no prefix)
doc_embedding = model.encode("def authenticate(user): ...")

# Query embedding (with prefix)
query_embedding = model.encode(QUERY_INSTRUCTION + "how to authenticate")
```

## Next Steps

After this step completes:
- **mm-server/specs/07:** Build system prompts that include search results
- **mm-web/specs/08:** Add search UI

---

**Related specs in other projects:**
- [mm-server/specs/05-tool-integration.md](../../mm-server/specs/05-tool-integration.md) - Adapters that call search
- [mm-server/specs/07-system-prompts.md](../../mm-server/specs/07-system-prompts.md) - Uses search results
