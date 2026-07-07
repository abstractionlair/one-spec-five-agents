# mm-search

Local search service for the Multi-Model Chat system. Provides hybrid full-text and semantic search across project files and conversations.

## Quick Start

```bash
# Install dependencies
cd mm-search
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# Run the service
uvicorn src.main:app --host 127.0.0.1 --port 8001
```

## API

### POST /search

Search files and conversations.

```json
{
  "query": "authentication flow",
  "project_id": "proj_abc123",
  "limit": 10,
  "semantic_weight": 0.5
}
```

Response:
```json
{
  "results": [
    {
      "content": "def authenticate(user)...",
      "source_type": "file",
      "source_id": "file_xyz",
      "score": 0.85,
      "location": {"path": "src/auth.py", "start_line": 45}
    }
  ]
}
```

### POST /index

Index a file manually.

```json
{
  "project_id": "proj_abc123",
  "path": "src/auth.py",
  "content": "..."
}
```

### DELETE /index/{project_id}/{path}

Remove a file from the index.

### POST /reindex

Re-index all files in a project.

```json
{
  "project_id": "proj_abc123"
}
```

## Architecture

```
mm-search/
  src/
    main.py       # FastAPI app (port 8001)
    watcher.py    # inotify file watching (watchdog)
    chunker.py    # Text → ~500 token chunks
    embedder.py   # Qwen3-Embedding-0.6B
    search.py     # Hybrid FTS + vector search
    db.py         # content_chunks table
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | Postgres connection string | required |
| PROJECTS_ROOT | Path to project files | /srv/projects |
| EMBEDDING_MODEL | Model name | Qwen/Qwen3-Embedding-0.6B |

## Testing

```bash
pytest tests/ -v
```

## Deployment

Managed by systemd. See parent [ARCHITECTURE.md](../ARCHITECTURE.md) for deployment details.

```bash
sudo systemctl start mm-search
sudo systemctl status mm-search
journalctl -u mm-search -f
```

## Related

- [mm-server](../mm-server/) - Backend API that calls this service
- [Parent project](../) - Full system overview
