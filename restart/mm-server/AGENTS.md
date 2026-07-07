# mm-server

Backend API: conversations, model adapters, sandbox execution, and turn orchestration.

## Scope

This is the **main backend service**. It handles:
- Project and file management
- Conversation storage (markdown files)
- Model adapters (OpenAI, Anthropic, etc.)
- Bubblewrap sandbox execution
- Roundtable message building (the core differentiator)
- Turn orchestration (/api/turn)

It does **NOT** handle:
- Search indexing or embeddings (calls mm-search)
- Frontend rendering (serves static files or use nginx)

## API Contract

Defined in `openapi.yaml`. Key endpoints:

```
POST /api/turn
  body: {project_id, conversation_id?, user_message, target_models[]}
  returns: {conversation_id, round_number, responses[]}

GET/POST /api/projects
GET/POST /api/projects/{id}/files
GET/POST /api/projects/{id}/conversations
```

## File Structure

```
mm-server/
  pyproject.toml
  openapi.yaml           # API contract (consumed by mm-web)
  src/
    main.py              # FastAPI app, port 3000
    db.py                # Database (projects, conversations, files tables)
    adapters/
      base.py            # AdapterResult, ToolDefinition
      openai.py          # OpenAI API wrapper
      anthropic.py       # Anthropic API wrapper
    execution/
      sandbox.py         # Bubblewrap execution
      tools.py           # Tool definitions (bash)
    conversations/
      writer.py          # Save messages to markdown
      reader.py          # Load messages from markdown
      context.py         # Context management, token counting
    prompts/
      builder.py         # Roundtable message building
    files/
      storage.py         # File operations
    projects/
      routes.py          # Project CRUD
  tests/
```

## The Roundtable Pattern

This is the **core differentiator**. When building messages for a model:
- Other models' responses appear as `[ModelName]: ...` tags
- Its own responses appear as normal `assistant` messages

See `src/prompts/builder.py` for implementation.

## Database

This service **owns** these tables:
- `projects` - Project metadata
- `project_files` - File metadata (content on filesystem)
- `conversations` - Conversation metadata
- `conversation_messages` - Message metadata (content in .md files)
- `config` - App configuration

It does **NOT** own `content_chunks` (that's mm-search).

## External Dependencies

- **mm-search:** Called via HTTP for search queries
  ```python
  response = await httpx.post(f"{SEARCH_URL}/search", json={...})
  ```

- **Postgres:** Direct connection for owned tables

- **Filesystem:** `/srv/projects/{project_id}/` for files and conversations

## Technology

- Python 3.12+
- FastAPI + uvicorn
- asyncpg for Postgres
- httpx for calling mm-search
- bubblewrap for sandboxing

## Environment Variables

```
DATABASE_URL=postgresql://mm:password@localhost/mmchat
SEARCH_URL=http://127.0.0.1:8001
PROJECTS_ROOT=/srv/projects
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Testing

```bash
cd mm-server
python -m pytest tests/ -v
```

## Running

```bash
cd mm-server
uvicorn src.main:app --host 0.0.0.0 --port 3000
```

In production, managed by systemd. See ARCHITECTURE.md in parent directory.
