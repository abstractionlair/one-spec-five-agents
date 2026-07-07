# Architecture: mm-server

## Overview

mm-server is the backend API that orchestrates multi-model conversations.

```
┌─────────────────────────────────────────────────────────────────┐
│                          mm-server                               │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Adapters │ │ Sandbox  │ │  Convos  │ │ Roundtable/Turn  │   │
│  │ OpenAI   │ │ Bubblewrap│ │ Storage │ │ Orchestration    │   │
│  │ Anthropic│ │          │ │          │ │                  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│         │           │            │                │             │
│         └───────────┴────────────┴────────────────┘             │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
          │                    │                    │
          │ HTTP               │ SQL                │ Filesystem
          ▼                    ▼                    ▼
┌──────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│    mm-search     │  │    Postgres     │  │   /srv/projects/    │
│                  │  │                 │  │                     │
└──────────────────┘  └─────────────────┘  └─────────────────────┘
```

## Components

### Adapters (src/adapters/)

Provider-specific API wrappers implementing a common interface.

```python
# src/adapters/base.py
class BaseAdapter:
    async def send(
        self,
        model: str,
        messages: list[dict],
        system: str | None = None,
        tools: list[dict] | None = None
    ) -> AdapterResponse
```

**Current adapters:**
- `openai.py` - GPT-4o, GPT-4o-mini, etc.
- `anthropic.py` - Claude Sonnet, Claude Opus, etc.

**Adding a new provider:**
1. Create `src/adapters/{provider}.py`
2. Implement `BaseAdapter` interface
3. Register in `src/adapters/__init__.py`

### Sandbox (src/execution/)

Bubblewrap-based code execution.

```python
# src/execution/sandbox.py
async def execute_bash(
    command: str,
    project_id: str,
    timeout: int = 60,
    network: bool = True
) -> ExecutionResult
```

**Security model:**
- Filesystem: Only `/workspace` (project directory) is writable
- Process: PID namespace isolation
- Network: Enabled by default (for package installs)
- Timeout: 60s default, kills on exceed

### Conversations (src/conversations/)

Markdown file storage with YAML frontmatter.

```
/srv/projects/{project_id}/.metadata/.conversations/{conv_id}/
  rounds/
    001-user.md
    001-agent-gpt-4o.md
    001-agent-claude-sonnet.md
    002-user.md
    ...
```

**File format:**
```markdown
---
id: msg_abc123
speaker: agent:gpt-4o
model: gpt-4o
provider: openai
round: 1
timestamp: 2025-01-15T10:30:00Z
usage:
  input_tokens: 1250
  output_tokens: 432
---

The authentication flow works by first checking...
```

### Prompts (src/prompts/)

Roundtable message building - the core differentiator.

```python
# src/prompts/builder.py
def build_messages(
    conversation: list[Message],
    target_model_id: str,
    system_prompt: str
) -> list[dict]
```

**Key insight:** Each model gets a personalized view where:
- Other models' responses are `[ModelName]: ...` tags in user messages
- Its own responses are normal `assistant` messages

### Projects & Files (src/projects/, src/files/)

Project CRUD and file storage.

**Database tables owned:**
- `projects` - Project metadata
- `project_files` - File metadata (content on filesystem)
- `conversations` - Conversation metadata
- `conversation_messages` - Message metadata

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/turn` | POST | Execute conversation turn |
| `/api/projects` | GET/POST | List/create projects |
| `/api/projects/{id}` | GET/PUT/DELETE | Project CRUD |
| `/api/projects/{id}/files` | GET/POST | List/upload files |
| `/api/projects/{id}/files/{path}` | GET/DELETE | File operations |
| `/api/projects/{id}/conversations` | GET/POST | Conversation management |

## Data Flow: /api/turn

```
POST /api/turn
{project_id, conversation_id, user_message, target_models[]}
       │
       ▼
1. Save user message
   └─> Write .md file + insert metadata
       │
       ▼
2. For each model (parallel):
   ├─> Build system prompt (project context, tools)
   ├─> Load conversation history
   ├─> Build per-model message view (roundtable)
   │
   ├─> Call model adapter
   │   └─> Tool calling loop:
   │       ├─> Model requests bash
   │       ├─> Execute in bubblewrap sandbox
   │       └─> Return result to model
   │
   └─> Save agent response (.md + metadata)
       │
       ▼
3. Return responses[]
```

## External Dependencies

| Service | Protocol | Purpose |
|---------|----------|---------|
| mm-search | HTTP | Search queries |
| Postgres | SQL | Metadata storage |
| Filesystem | FS | Content storage |
| OpenAI API | HTTPS | GPT models |
| Anthropic API | HTTPS | Claude models |

## Database Schema

**Tables owned by mm-server:**

```sql
-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Files (metadata only, content on filesystem)
CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  path TEXT NOT NULL,
  content_hash TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  UNIQUE(project_id, path)
);

-- Conversations
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  title TEXT,
  round_count INTEGER DEFAULT 0
);

-- Messages (metadata only, content in .md files)
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  round_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  file_path TEXT NOT NULL,
  model_id TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER
);

-- Config
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## Configuration

```bash
# .env
DATABASE_URL=postgresql://mm:password@localhost/mmchat
SEARCH_URL=http://127.0.0.1:8001
PROJECTS_ROOT=/srv/projects
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Performance

| Operation | Latency |
|-----------|---------|
| Save message | ~10-50ms |
| Load conversation | ~5-20ms |
| Build messages | ~5-10ms |
| Sandbox startup | ~1ms |
| Model API call | ~2-15s (variable) |

Total `/api/turn` latency dominated by model API calls.

## For System Context

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for:
- How mm-server fits in the three-project architecture
- Deployment configuration
- Inter-service communication
