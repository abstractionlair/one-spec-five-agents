# Vision: mm-server

## Purpose

Backend API service that orchestrates multi-model conversations with tool execution support.

## Scope

This service **handles**:
- Project management (CRUD)
- File storage and metadata
- Conversation storage (markdown files + database)
- Model adapters (OpenAI, Anthropic, future: Google, xAI)
- Bubblewrap sandbox execution
- Turn orchestration (`/api/turn`)
- Roundtable message building (the core differentiator)

This service **does NOT handle**:
- Search indexing or embeddings (calls mm-search)
- Frontend rendering (serves static files or proxied by nginx)
- User authentication (single-user system)

## The Roundtable Pattern

The core differentiator of this system. When building messages for a model:

1. **Other models' responses** appear as `[ModelName]: ...` tags
2. **Its own responses** appear as normal `assistant` messages
3. **The current model** sees a conversation where it's the assistant and others are tagged speakers

This creates a roundtable discussion where models can:
- Build on each other's ideas
- Disagree and provide alternatives
- Synthesize multiple perspectives

See [specs/05b-message-building.md](specs/05b-message-building.md) for implementation.

## Design Principles

### 1. Filesystem as Source of Truth

Conversations stored as markdown files:
- Human-readable
- Git-compatible
- Standard tools work (grep, editors)
- Portable (copy directory = copy project)

Database stores metadata for fast queries; filesystem stores content.

### 2. Provider-Agnostic Adapters

Each model provider has its own adapter implementing a common interface:

```python
class BaseAdapter:
    async def send(self, model, messages, system, tools) -> AdapterResponse
```

Adding a new provider = one new file. No changes to orchestration logic.

### 3. Sandboxed Execution

Models execute bash commands in bubblewrap sandboxes:
- Filesystem isolation (only sees project directory)
- Process isolation (PID namespace)
- Optional network access
- ~1ms startup overhead

Enables code execution, package installation, file manipulation.

## Success Criteria

- Multi-model conversations work with roundtable message building
- Tool calls execute in isolated sandboxes
- API response time < 500ms (excluding model latency)
- Conversations persist correctly as markdown

## Non-Goals

- Real-time streaming (batch responses acceptable)
- Multi-user support (single-user first)
- Model training or fine-tuning
- Image/video generation

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| API | FastAPI | Async, fast, OpenAPI docs |
| Database | Postgres + asyncpg | Async driver, concurrent access |
| Model SDKs | openai, anthropic | Official SDKs |
| Sandbox | Bubblewrap | ~1ms startup, Linux-native |
| HTTP client | httpx | Async, for mm-search calls |

## Relationship to System

mm-server is the central hub:

```
mm-web → HTTP → mm-server → HTTP → mm-search
                    ↓
               Postgres (projects, conversations, files)
                    ↓
               Filesystem (/srv/projects/)
                    ↓
               Model APIs (OpenAI, Anthropic)
```

For full system context, see [../VISION.md](../VISION.md).
