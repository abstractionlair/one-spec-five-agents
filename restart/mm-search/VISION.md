# Vision: mm-search

## Purpose

Standalone search service providing hybrid full-text and semantic search across project content.

## Scope

This service **handles**:
- File content indexing (code, docs, data)
- Conversation message indexing
- Full-text search (Postgres tsvector)
- Semantic search (pgvector + embeddings)
- Auto-indexing via filesystem watching (inotify)
- Chunking large files into searchable segments

This service **does NOT handle**:
- Conversations or chat logic
- LLM adapters or model providers
- User authentication
- Project management (CRUD)
- Frontend UI

## Design Principles

### 1. Standalone Service

mm-search knows nothing about the chat system. It receives content to index and queries to search. This separation allows:
- Independent development and testing
- Clear API contract
- Potential reuse for other applications

### 2. Local-First

All processing happens locally:
- **Embeddings:** Qwen3-Embedding-0.6B runs on CPU (~10ms per chunk)
- **Search:** Postgres with pgvector (no external search service)
- **File watching:** inotify via watchdog (no polling)

No external API dependencies for search functionality.

### 3. Hybrid Search

Combines keyword and semantic search:
- **FTS (tsvector):** Fast, exact keyword matching
- **Vector similarity:** Semantic understanding of queries
- **Combined scoring:** Weighted blend of both

Users get relevant results whether they search for exact terms or conceptual queries.

## Success Criteria

- Search latency < 100ms (p95) for typical queries
- Relevant results in top 5 for both keyword and semantic queries
- Auto-indexing detects changes within 1 second
- Handles 100k+ chunks without degradation

## Non-Goals

- Real-time streaming results
- Multi-tenancy or access control
- Cross-project search
- Custom ranking algorithms per project

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| API | FastAPI | Async, fast, OpenAPI docs |
| Database | Postgres + pgvector | FTS + vectors in one DB |
| Embeddings | Qwen3-Embedding-0.6B | Local, fast, good quality |
| File watching | watchdog | Cross-platform inotify |

## Relationship to System

mm-search is called by mm-server:
```
mm-server → HTTP → mm-search → Postgres (content_chunks)
```

mm-search owns the `content_chunks` table. No other service reads or writes it directly.

For full system context, see [../VISION.md](../VISION.md).
