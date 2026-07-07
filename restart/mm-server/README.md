# mm-server

Backend API for the Multi-Model Chat system. Handles conversations, model adapters, sandbox execution, and turn orchestration.

## Quick Start

```bash
# Install dependencies
cd mm-server
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Configure environment
cp .env.example .env
# Edit .env with your API keys and DATABASE_URL

# Run the service
uvicorn src.main:app --host 0.0.0.0 --port 3000
```

## API Overview

Full API specification in [openapi.yaml](openapi.yaml).

### Core Endpoints

**POST /api/turn** - Execute a conversation turn

```json
{
  "project_id": "proj_abc",
  "conversation_id": "conv_xyz",
  "user_message": "Explain recursion",
  "target_models": [
    {"provider": "openai", "modelId": "gpt-4o"},
    {"provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}
  ]
}
```

Response includes responses from all models in parallel.

**GET/POST /api/projects** - Project CRUD
**GET/POST /api/projects/{id}/files** - File management
**GET/POST /api/projects/{id}/conversations** - Conversation management

## Architecture

```
mm-server/
  src/
    main.py              # FastAPI app (port 3000)
    db.py                # Database operations
    adapters/
      openai.py          # OpenAI API wrapper
      anthropic.py       # Anthropic API wrapper
    execution/
      sandbox.py         # Bubblewrap sandbox
      tools.py           # Tool definitions
    conversations/
      writer.py          # Save to markdown
      reader.py          # Parse markdown
      context.py         # Context management
    prompts/
      builder.py         # Roundtable message building
    files/
      storage.py         # File operations
    projects/
      routes.py          # Project CRUD
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## The Roundtable Pattern

The core differentiator: **each model sees other models' responses** but its own responses appear as assistant messages. This creates a roundtable discussion.

See [specs/05b-message-building.md](specs/05b-message-building.md) for implementation details.

## Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | Postgres connection string | Yes |
| SEARCH_URL | mm-search service URL | Yes |
| PROJECTS_ROOT | Path to project files | Yes |
| OPENAI_API_KEY | OpenAI API key | For OpenAI models |
| ANTHROPIC_API_KEY | Anthropic API key | For Anthropic models |

## External Dependencies

- **mm-search:** HTTP calls for search queries
- **Postgres:** Direct connection for projects, conversations, files
- **Filesystem:** `/srv/projects/{project_id}/` for file storage

## Testing

```bash
pytest tests/ -v
```

## Deployment

Managed by systemd. See parent [ARCHITECTURE.md](../ARCHITECTURE.md) for deployment details.

```bash
sudo systemctl start mm-server
sudo systemctl status mm-server
journalctl -u mm-server -f
```

## Related

- [mm-search](../mm-search/) - Search service (called by this service)
- [mm-web](../mm-web/) - Frontend (calls this service)
- [Parent project](../) - Full system overview
