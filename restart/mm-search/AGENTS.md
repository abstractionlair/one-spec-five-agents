# mm-search

Local search service: file watching, chunking, embeddings, and hybrid search.

## Scope

This is a **standalone service**. It knows nothing about:
- Conversations or chat
- LLM adapters or model providers
- The frontend UI
- Roundtable message building

It only knows about:
- Files on disk (watching via inotify)
- Chunks and embeddings (content_chunks table)
- Search queries (FTS + vector)

## API Contract

```
POST /search
  body: {query: str, project_id: str, limit?: int, semantic_weight?: float}
  returns: {results: [{content, source_type, source_id, score, location}]}

POST /index
  body: {project_id: str, path: str, content: str}
  returns: {chunks_created: int}

DELETE /index/{project_id}/{path}
  returns: {ok: bool}

POST /reindex
  body: {project_id: str}
  returns: {files_indexed: int}
```

## File Structure

```
mm-search/
  pyproject.toml
  src/
    main.py          # FastAPI app, port 8001
    watcher.py       # inotify filesystem watching (watchdog)
    chunker.py       # Text → chunks (~500 tokens)
    embedder.py      # Qwen3-Embedding-0.6B via sentence-transformers
    search.py        # Hybrid FTS + vector search
    db.py            # Database operations (owns content_chunks table)
  tests/
    test_chunker.py
    test_search.py
```

## Database

This service **owns** the `content_chunks` table:

```sql
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,      -- "file" or "conversation_message"
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  chunk_index INTEGER,
  content TEXT NOT NULL,
  location JSONB,
  token_count INTEGER,
  search_vector tsvector,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

No other service should read or write this table directly.

## Technology

- Python 3.12+
- FastAPI + uvicorn
- asyncpg for Postgres
- sentence-transformers with Qwen3-Embedding-0.6B
- watchdog for inotify
- pgvector for vector search

## Testing

```bash
cd mm-search
python -m pytest tests/ -v
```

## Running

```bash
cd mm-search
uvicorn src.main:app --host 127.0.0.1 --port 8001
```

In production, managed by systemd. See ARCHITECTURE.md in parent directory.
