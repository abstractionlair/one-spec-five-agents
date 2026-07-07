# Architecture: mm-search

## Overview

mm-search is a standalone FastAPI service that provides hybrid search (FTS + semantic) over project content.

```
┌─────────────────────────────────────────────────────────┐
│                       mm-search                          │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Watcher  │  │ Chunker  │  │ Embedder │  │ Search  │ │
│  │(watchdog)│  │          │  │ (Qwen3)  │  │  API    │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │             │             │             │       │
│       └─────────────┴─────────────┴─────────────┘       │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Postgres   │
                    │             │
                    │ content_    │
                    │ chunks      │
                    └─────────────┘
```

## Components

### Watcher (src/watcher.py)

Monitors filesystem for changes using watchdog (inotify on Linux).

```python
# Triggers on file create/modify/delete
observer.schedule(handler, PROJECTS_ROOT, recursive=True)
```

**Responsibilities:**
- Detect file changes in `/srv/projects/*/workspace/`
- Debounce rapid changes (e.g., during builds)
- Ignore patterns: `.git`, `node_modules`, `.venv`, `__pycache__`

### Chunker (src/chunker.py)

Splits content into searchable segments.

**Strategy:**
- ~500 tokens per chunk (line-boundary splits)
- Preserves line numbers for source location
- Conversations: one chunk per message

```python
def chunk_by_lines(text: str, lines_per_chunk: int = 50) -> list[Chunk]
```

### Embedder (src/embedder.py)

Generates vector embeddings using Qwen3-Embedding-0.6B.

**Key details:**
- 1024-dimensional output
- Asymmetric search: queries get instruction prefix, documents don't
- Runs on CPU (~10ms per chunk)
- Model cached in `~/.cache/huggingface/`

```python
class Embedder:
    def embed_documents(self, texts: list[str]) -> list[list[float]]
    def embed_query(self, query: str) -> list[float]  # With instruction prefix
```

### Search (src/search.py)

Hybrid search combining FTS and vector similarity.

**FTS (keyword):**
```sql
SELECT ... FROM content_chunks
WHERE search_vector @@ to_tsquery('english', $1)
ORDER BY ts_rank(search_vector, query) DESC
```

**Vector (semantic):**
```sql
SELECT ... FROM content_chunks
ORDER BY embedding <=> $1::vector
LIMIT $2
```

**Hybrid:**
1. Run both queries
2. Normalize scores
3. Combine with configurable weights
4. Return top-k

### Database (src/db.py)

Owns the `content_chunks` table:

```sql
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- "file" or "conversation_message"
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  chunk_index INTEGER,
  content TEXT NOT NULL,
  location JSONB,                   -- {path, start_line, end_line} or {conv_id, round}
  token_count INTEGER,
  search_vector tsvector,           -- Postgres FTS
  embedding vector(1024),           -- pgvector
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_search ON content_chunks USING GIN(search_vector);
CREATE INDEX idx_chunks_embedding ON content_chunks USING ivfflat(embedding vector_cosine_ops);
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/search` | POST | Query files and conversations |
| `/index` | POST | Index a file or message |
| `/index/{project_id}/{path}` | DELETE | Remove from index |
| `/reindex` | POST | Re-index entire project |

## Data Flow

### Indexing

```
File Created/Modified
       │
       ▼
  ┌─────────┐
  │ Watcher │ Detects via inotify
  └────┬────┘
       │
       ▼
  ┌─────────┐
  │ Chunker │ Split into ~500 token chunks
  └────┬────┘
       │
       ▼
  ┌──────────┐
  │ Embedder │ Generate 1024-dim vectors
  └────┬─────┘
       │
       ▼
  ┌──────────┐
  │ Postgres │ INSERT with tsvector + embedding
  └──────────┘
```

### Searching

```
Query: "authentication flow"
       │
       ├─────────────────┐
       ▼                 ▼
  ┌─────────┐      ┌──────────┐
  │   FTS   │      │ Embedder │ embed_query()
  │ ts_rank │      └────┬─────┘
  └────┬────┘           │
       │                ▼
       │         ┌──────────┐
       │         │ pgvector │ cosine similarity
       │         └────┬─────┘
       │              │
       ▼              ▼
  ┌──────────────────────┐
  │   Combine & Re-rank  │
  │  (weighted scoring)  │
  └──────────┬───────────┘
             │
             ▼
        Results []
```

## Performance

| Operation | Latency |
|-----------|---------|
| Embed single chunk | ~10ms |
| Embed batch (100 chunks) | ~500ms |
| FTS query | ~10-50ms |
| Vector query | ~5-30ms |
| Hybrid query | ~50-100ms |

## Configuration

```bash
# .env
DATABASE_URL=postgresql://mm:password@localhost/mmchat
PROJECTS_ROOT=/srv/projects
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B
```

## External Dependencies

- **Postgres:** Direct SQL connection (asyncpg)
- **Filesystem:** Read access to `/srv/projects/`
- **No external APIs:** All processing is local

## Scaling Considerations

Current design handles:
- Up to ~1M chunks (ivfflat index)
- Single-user workloads

For larger scale:
- Consider HNSW index instead of ivfflat
- Batch embedding updates
- Dedicated search service (Qdrant, Pinecone)

## For System Context

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for:
- How mm-search fits in the three-project architecture
- Deployment configuration
- Inter-service communication
