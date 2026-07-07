# Architecture

## Three-Project Structure

The system is split into three independent projects that communicate via HTTP APIs:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        mm-web                                    │
│                   (Static HTML/JS)                               │
│                   Served by nginx or mm-server                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (REST API)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       mm-server                                  │
│                   (Python/FastAPI)                               │
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
│  (Python/FastAPI)│  │  (shared, but   │  │                     │
│                  │  │   separate      │  │  {project-id}/      │
│ ┌──────────────┐ │  │   schemas)      │  │    workspace/       │
│ │ File Watcher │ │  │                 │  │    .metadata/       │
│ │ Chunker      │ │  └─────────────────┘  └─────────────────────┘
│ │ Embedder     │ │           ▲
│ │ Search API   │ │           │ SQL
│ └──────────────┘ │           │
│         │        │───────────┘
└──────────────────┘
```

**Why three projects?**

| Concern | Benefit |
|---------|---------|
| Cognitive load | Each project fits in one context window |
| Different tooling | Python vs JS, separate linters/tests |
| Explicit interfaces | HTTP APIs force well-designed contracts |
| Independent development | Work on UI without seeing adapter code |
| Unix philosophy | Each does one thing well |

**Communication:**

| From | To | Interface |
|------|----|-----------|
| mm-web | mm-server | HTTP REST (openapi.yaml) |
| mm-server | mm-search | HTTP REST (search API) |
| mm-server | Postgres | SQL (conversations, projects, files) |
| mm-search | Postgres | SQL (content_chunks - owns this schema) |
| mm-server | Filesystem | Read/write project files |
| mm-search | Filesystem | inotify watches for indexing |

## Directory Structure

```
mm-search/               # Search service (Python)
  AGENTS.md              # Focused instructions for this project
  pyproject.toml
  src/
    main.py              # FastAPI app, port 8001
    watcher.py           # inotify filesystem watching
    chunker.py           # Text → chunks (~500 tokens)
    embedder.py          # Qwen3-Embedding-0.6B
    search.py            # Hybrid FTS + vector search
    db.py                # Owns content_chunks table
  tests/

mm-server/               # Backend API (Python)
  AGENTS.md              # Focused instructions for this project
  pyproject.toml
  openapi.yaml           # API contract for mm-web
  src/
    main.py              # FastAPI app, port 3000
    adapters/
      base.py            # AdapterResult, ToolDefinition
      openai.py          # OpenAI API
      anthropic.py       # Anthropic API
    execution/
      sandbox.py         # Bubblewrap execution
      tools.py           # Tool definitions
    conversations/
      writer.py          # Message → markdown file
      reader.py          # Markdown file → parsed
      context.py         # Context management
    prompts/
      builder.py         # Roundtable message building
    files/
      storage.py         # File operations
    projects/
      routes.py          # Project CRUD
    db.py                # Owns projects, conversations, files tables
  tests/

mm-web/                  # Frontend (JavaScript)
  AGENTS.md              # Focused instructions for this project
  package.json
  openapi.yaml           # Copy of API contract (or fetched)
  src/
    index.html
    app.js
    styles.css
  tests/

/srv/projects/           # Project storage (Linux host path)
  {project-id}/
    workspace/           # User-accessible files (LLM workspace)
    .pyenv/              # Project-specific Python (managed by models)
    .nvm/                # Project-specific Node (managed by models)
    .metadata/           # App data, conversation history
      .conversations/    # Markdown conversations
        {conv-id}/
          rounds/
            001-user.md
            001-agent-{model}.md
```

## Data Flow: /api/turn

Request arrives:
```python
POST /api/turn
{
  "userMessage": "Analyze sales data",
  "targetModels": [{"provider": "openai", "modelId": "gpt-4o"}],
  "conversationId": "conv-123",
  "projectId": "proj-456"
}
```

**Execution DAG:**

```
1. Save user message
   └─> Write to .conversations/{conv-id}/rounds/{N}-user.md
   └─> Insert metadata to conversation_messages table
   └─> Index message in Postgres FTS

2. For each model (parallel execution):
   ├─> Build system prompt
   │   └─> Query project_files for file listing
   │   └─> Format bash tool instructions
   │   └─> Include project context
   │
   ├─> Load conversation history
   │   └─> Query conversation_messages for round order
   │   └─> Read .md files from filesystem
   │   └─> Parse YAML frontmatter + content
   │
   ├─> Call model adapter
   │   └─> Provider-specific API call (OpenAI/Anthropic/etc)
   │   └─> Tools available: [bash]
   │
   ├─> Tool calling loop:
   │   ├─> Model requests bash execution
   │   ├─> Bubblewrap sandbox spawned:
   │   │   bwrap \
   │   │     --ro-bind /usr /usr \
   │   │     --ro-bind /lib /lib \
   │   │     --ro-bind /lib64 /lib64 \
   │   │     --bind {projectDir} /workspace \
   │   │     --tmpfs /tmp \
   │   │     --unshare-all \
   │   │     --die-with-parent \
   │   │     bash -c "{command}"
   │   ├─> Results (stdout, stderr, exit_code) → model
   │   └─> Model generates final response
   │
   └─> Save agent message
       └─> Write to .conversations/{conv-id}/rounds/{N}-agent-{model}.md
       └─> Insert metadata to conversation_messages table
       └─> Index message in Postgres FTS

3. Return responses
   └─> Array of {modelId, text, usage, toolCallsMade}
```

**Parallel execution:** Each model queries independently. No shared state except project filesystem (read-write safe—models don't typically conflict).

## Per-Model View Building (The Roundtable Pattern)

The core insight: **each model gets a personalized view of the conversation** that includes other models' responses but not its own. This creates the "roundtable" dynamic where models can build on each other's ideas.

### How It Works

When building the message history for a model, the system:

1. **Includes all prior user messages**
2. **For each round, shows OTHER models' responses** as tagged blocks (e.g., `[GPT-4]: ...`)
3. **Excludes the target model's own responses** from tagged blocks—those appear as normal `assistant` messages instead
4. **Applies per-provider formatting** (OpenAI system message vs Anthropic separate system param)

### Example: Three Models, Two Rounds

**Round 1 (stored):**
- User: "Explain recursion"
- GPT-4: "Recursion is a function calling itself..."
- Claude: "Think of it like Russian nesting dolls..."
- Gemini: "A recursive function has a base case and..."

**What Claude sees in Round 2** (when user asks "Give me an example"):
```
System: You are claude-opus in a multi-agent conversation...

User: Explain recursion
[GPT-4]: Recursion is a function calling itself...
[Gemini]: A recursive function has a base case and...

Assistant (Claude's prior response): Think of it like Russian nesting dolls...

User: Give me an example
```

Note: Claude's Round 1 response appears as `assistant`, not as a tagged `[Claude]:` block. The model sees itself as the assistant and others as tagged speakers.

### Implementation: build_tagged_block()

```python
def build_tagged_block(
    user_message: str,
    agents: list[AgentResponse],
    target_model_id: str,
    target_agent_id: str | None
) -> str:
    """Build a user block with tagged responses from other models."""
    lines = [f"User: {user_message}"]

    for agent in agents:
        # Skip if this is the target model (avoid self-duplication)
        if agent_matches(agent, target_model_id, target_agent_id):
            continue

        # Tag other models' responses: [ModelName]: response
        tag = agent.name or agent.model_id or "agent"
        if agent.content and agent.content.strip():
            lines.append(f"[{tag}]: {agent.content.strip()}")

    return "\n".join(lines)
```

### System Prompt for Multi-Model Context

Each model receives a personalized system prompt explaining the conversation format:

```
You are {model_id} in a multi-agent conversation with one user and multiple AI agents.
You will see the full conversation from the beginning: each user message followed by
other agents' replies tagged in brackets, e.g., [GPT-4]: ...

Your own previous replies appear as assistant messages.

Respond once per user turn, primarily addressing the user directly but also addressing
the other models as appropriate.

Coordination: Replies are collected in parallel and shown together; do not claim to
"go first" or "start the discussion". Avoid meta-openers; contribute your content directly.
```

This prompt prevents models from claiming to start the discussion (they respond simultaneously) and helps them understand the tagged format.

**Latency breakdown (typical):**
- Message save: ~10-50ms
- System prompt build: ~5-10ms
- Model API call: ~1-10s (depends on model, prompt length, tool use)
- Bubblewrap execution per command: ~5-50ms (startup ~1ms, execution variable)
- Message index: ~50-200ms
- Total: ~2-12s per model (dominated by API call; sandbox overhead negligible)

## Database Schema

**Note:** Using Postgres with pgvector extension for vector similarity search. SQLite FTS5 replaced with Postgres full-text search + pgvector for embeddings.

### Metadata Tables

**projects** — Container for files and conversations
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- proj_{timestamp}_{random}
  name TEXT NOT NULL,
  path TEXT NOT NULL,               -- Filesystem path to project directory
  settings JSONB,                   -- {allow_network, model_config, ...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**project_files** — File metadata (content on filesystem)
```sql
CREATE TABLE project_files (
  id TEXT PRIMARY KEY,              -- file_{timestamp}_{random}
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,               -- Relative: "workspace/data/sales.csv"
  content_hash TEXT,                -- SHA256(file content)
  mime_type TEXT,
  size_bytes BIGINT,
  mtime BIGINT,                     -- File modification time (for change detection)
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, path)
);
-- Physical location: /srv/projects/{project_id}/workspace/{path}
```

**Change detection:** Indexer daemon watches via inotify. On startup, reconciles by comparing mtime + content_hash. Re-indexes only changed files.

**conversations** — Conversation metadata
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,              -- conv_{timestamp}_{random}
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings JSONB,                   -- {summary, preferences, ...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
```

**conversation_messages** — Message metadata (content in .md files)
```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,              -- msg_{timestamp}_{random}
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,    -- User + all agents = 1 round
  speaker TEXT NOT NULL,            -- "user" or "agent:{model-id}"
  file_path TEXT NOT NULL,          -- ".metadata/.conversations/{conv-id}/rounds/001-user.md"
  model_id TEXT,                    -- NULL for user, model ID for agents
  provider TEXT,                    -- "openai", "anthropic", etc.
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX idx_messages_round ON conversation_messages(conversation_id, round_number);
-- Physical location: /srv/projects/{project_id}/.metadata/.conversations/{conv-id}/rounds/
```

**Message file format:**
```markdown
---
id: msg_abc123_def456
speaker: agent:gpt-4o
model: gpt-4o
provider: openai
round: 1
timestamp: 2025-01-15T10:30:00.000Z
usage:
  input_tokens: 1250
  output_tokens: 432
---

The authentication flow works by first checking...
```

YAML frontmatter provides structured metadata. Body contains message content. Both searchable.

**config** — Application configuration
```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT,                       -- JSON
  updated_at INTEGER NOT NULL
);
```

Stores: schema version, system prompts, defaults.

### Search Tables (owned by mm-search)

These tables are managed by the mm-search service. mm-server does not read or write them directly—it calls mm-search's HTTP API.

**content_chunks** — Chunked content for indexing (includes embeddings)
```sql
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- "file" or "conversation_message"
  source_id TEXT NOT NULL,          -- Foreign key to project_files or conversation_messages
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER,              -- 0, 1, 2, ... for multi-chunk sources
  content TEXT NOT NULL,
  location JSONB,                   -- {path, start_line, end_line} or {conv_id, round, speaker}
  token_count INTEGER,
  search_vector tsvector,           -- Postgres full-text search vector
  embedding vector(1024),           -- pgvector embedding (Qwen3-Embedding-0.6B: 1024 dimensions)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chunks_source ON content_chunks(source_type, source_id);
CREATE INDEX idx_chunks_project ON content_chunks(project_id);
CREATE INDEX idx_chunks_search ON content_chunks USING GIN(search_vector);
CREATE INDEX idx_chunks_embedding ON content_chunks USING ivfflat(embedding vector_cosine_ops);
```

**Design note:** Embedding stored directly in `content_chunks` (not a separate table) to avoid joins during search. ivfflat index chosen for good recall at expected scale (<1M chunks).

**Chunking strategy:** Files split on line boundaries, ~50 lines or ~500 tokens per chunk. Conversations: one chunk per message (messages typically < 500 tokens).

**Search queries:**

Full-text search (keyword):
```sql
SELECT id, ts_rank(search_vector, query) as rank,
       ts_headline('english', content, query, 'MaxFragments=2') as snippet
FROM content_chunks, plainto_tsquery('english', $1) query
WHERE project_id = $2 AND search_vector @@ query
ORDER BY rank DESC LIMIT $3;
```

Semantic search (vector similarity):
```sql
SELECT id, content, embedding <=> $1 as distance
FROM content_chunks
WHERE project_id = $2
ORDER BY embedding <=> $1
LIMIT $3;
```

Hybrid search combines both, weighted by relevance.

## Bubblewrap Execution Model

**Sandbox lifecycle:** Ephemeral process isolation. Each bash command spawns a bubblewrap sandbox, executes, terminates. No daemon, no images—just direct process sandboxing.

**Why bubblewrap over Docker?**
- Lightweight: ~1ms startup overhead vs ~1-2s for Docker
- Simpler: No daemon, no image management, no container lifecycle
- Linux-native: Uses kernel namespaces directly (what Flatpak uses under the hood)
- Transparent: Projects are regular directories on the host filesystem

**Sandbox configuration:**
```bash
bwrap \
  --ro-bind /usr /usr \              # Read-only system binaries
  --ro-bind /lib /lib \              # Read-only libraries
  --ro-bind /lib64 /lib64 \          # Read-only 64-bit libraries
  --ro-bind /bin /bin \              # Read-only binaries
  --bind {projectDir} /workspace \   # RW project directory
  --tmpfs /tmp \                     # Ephemeral temp space
  --proc /proc \                     # Process info
  --dev /dev \                       # Device access
  --unshare-all \                    # Network, PID, IPC isolation
  --share-net \                      # Re-enable network for package installs
  --die-with-parent \                # Cleanup on parent exit
  --chdir /workspace \               # Working directory
  bash -c "{command}"                # Command to execute
```

**Project-local environments:** Models install tools directly into project directories:
- `.pyenv/` - Project-specific Python versions and virtualenvs
- `.nvm/` - Project-specific Node.js versions
- `node_modules/` - npm packages
- These persist across sandbox invocations and are visible on the host

See inspiration/Code-execution-with-MCP-building.md and inspiration/Code-Mode-the-better-way-to-use.md for background on the simple code execution design.

Example:
```bash
# First command: Models can install pyenv
bwrap ... bash -c "curl https://pyenv.run | PYENV_ROOT=$PWD/.pyenv bash"
# .pyenv/ now exists in project directory

# Second command: Create venv using project-local Python
bwrap ... bash -c "export PYENV_ROOT=$PWD/.pyenv && .pyenv/bin/pyenv install 3.12 && python3 -m venv .venv"

# Third command: Install packages
bwrap ... bash -c "source .venv/bin/activate && pip install pandas"

# Fourth command: Run code
bwrap ... bash -c "source .venv/bin/activate && python analyze.py"
```

**Security properties:**
- Filesystem isolation: Sandbox can only access /workspace (project directory). System directories are read-only.
- Process isolation: PID namespace prevents seeing host processes.
- Network access: Enabled by default for package installs. Can be disabled per-project with `--unshare-net`.
- Timeout: Commands killed after timeout (default 60s). Prevents infinite loops.
- Single-user model: Security is "good enough" for single-user local use—prevents accidents, not malicious actors.

**Note:** Bubblewrap is Linux-only. This architecture assumes hosting on a Linux server (Fedora recommended).

## Model Adapter Architecture

The system is designed to support multiple model providers through a unified adapter interface.

### Current Providers
- **OpenAI** - GPT-4o, GPT-4o-mini, etc.
- **Anthropic** - Claude Sonnet, Claude Opus, etc.

### Planned Providers
- **Google Gemini** - Gemini Pro, Gemini Ultra, etc.
- **xAI Grok** - Grok models

### Extensibility Pattern

Each adapter implements a common interface:

```python
# server/adapters/base.py - Interface contract
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class AdapterResponse:
    text: str
    usage: dict[str, int]  # {input_tokens, output_tokens}


class BaseAdapter(ABC):
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}

    @abstractmethod
    async def send(
        self,
        model: str,
        messages: list[dict],
        system: str | None = None,
        tools: list[dict] | None = None
    ) -> AdapterResponse:
        """Send messages with tool support, return response."""
        pass

    @abstractmethod
    def format_tool(self, tool: dict) -> dict:
        """Format tool definition for this provider's API."""
        pass

    @abstractmethod
    def list_models(self) -> list[str]:
        """List available models for this provider."""
        pass
```

```python
# server/adapters/__init__.py - Registry
from adapters.openai import OpenAIAdapter
from adapters.anthropic import AnthropicAdapter
from adapters.google import GoogleAdapter
from adapters.xai import XAIAdapter

ADAPTERS = {
    "openai": OpenAIAdapter,
    "anthropic": AnthropicAdapter,
    "google": GoogleAdapter,
    "xai": XAIAdapter,
    # Add new providers here
}


def get_adapter(provider: str) -> BaseAdapter:
    adapter_class = ADAPTERS.get(provider)
    if not adapter_class:
        raise ValueError(f"Unknown provider: {provider}")
    return adapter_class()
```

**Adding a new provider:**
1. Create `server/adapters/{provider}.py` implementing the base interface
2. Register in `server/adapters/__init__.py`
3. Add API key to `.env` (e.g., `XAI_API_KEY`)
4. Provider is immediately available in `/api/turn`

This pattern isolates provider-specific API quirks (auth, message format, tool calling conventions) from the rest of the system.

---

## API Contracts

### POST /api/turn

**Purpose:** Execute conversation round with model(s).

**Request:**
```typescript
{
  projectId: string,
  conversationId?: string,          // Creates new if omitted
  userMessage: string,
  targetModels: Array<{
    provider: "openai" | "anthropic" | "google",
    modelId: string
  }>,
  roundNumber?: number              // Auto-incremented if omitted
}
```

**Conversation lifecycle:**
- If `conversationId` is omitted, the server creates a new conversation for the given `projectId` and returns its ID in the response.
- If `roundNumber` is omitted, the server computes it as `conversation.round_count + 1` based on the current conversation metadata.
- The user message for the round is always saved to the filesystem (markdown file) and `conversation_messages` before calling any models.

**Context construction and history:**
- For each target model, the server:
  - Loads the conversation and its messages from the database + markdown files.
  - Builds a *system prompt* that includes:
    - Project name and basic metadata.
    - A file listing (truncated to a reasonable number of entries).
    - Instructions for using the bash tool (including venv, npm, and optional pixi usage).
    - The current round number and conversation framing.
  - Builds a **message history** by taking the last N messages (e.g., 10) from the conversation and mapping them to the provider’s chat format (`user` / `assistant` roles).
    - For OpenAI: system prompt is included as a `system` message at the start of the messages array.
    - For Anthropic: system prompt is passed as the separate `system` parameter; messages contain only `user`/`assistant` turns.
  - The current round’s user message is part of this history, so models always see the latest input plus recent context.

**Response:**
```typescript
{
  conversationId: string,
  roundNumber: number,
  responses: Array<{
    provider: string,
    modelId: string,
    response: string,
    usage: {input_tokens: number, output_tokens: number},
    error?: string
  }>
}
```

**Concurrency:** Models queried in parallel via `asyncio.gather()`. Responses arrive independently.

**Error handling:** If one model fails, others proceed. Failed models return `{error: string}` in response array.

### POST /api/projects/:id/files

**Purpose:** Upload or create file in project.

**Request (JSON):**
```typescript
{
  path: string,                     // Relative path: "data/sales.csv"
  content: string | Buffer,
  mimeType?: string
}
```

**Request (multipart/form-data):**
```
path: string
file: File
```

**Response:**
```typescript
{
  file: {
    id: string,
    path: string,
    content_hash: string,
    size_bytes: number
  }
}
```

**Side effects:**
1. File written to `projects/{project-id}/files/{path}`
2. Metadata inserted to `project_files` table
3. If text file, indexed automatically (chunks → Postgres FTS)

### POST /api/projects/:id/search

**Purpose:** Full-text search across files and conversations.

**Request:**
```typescript
{
  query: string,
  limit?: number,                   // Default 10
  includeFiles?: boolean,           // Default true
  includeConversations?: boolean    // Default true
}
```

**Response:**
```typescript
{
  results: Array<{
    type: "file" | "conversation",
    rank: number,                   // BM25 score (lower = better)
    snippet: string,                // Highlighted excerpt

    // If type === "file":
    file_path?: string,
    start_line?: number,
    end_line?: number,

    // If type === "conversation":
    conversation_id?: string,
    round?: number,
    speaker?: string
  }>
}
```

## Design Tradeoffs

### Filesystem vs. Database Content Storage

**Decision:** Content on filesystem, metadata in database.

**Alternatives considered:**
1. All in database (files as BLOBs)
2. All on filesystem (database just for search index)
3. Hybrid (current approach)

**Analysis:**

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| DB BLOBs | Atomic transactions, no sync issues | Can't use standard tools, large DB, export complex | No |
| Filesystem only | Simple, standard tools | No fast metadata queries, no FTS | No |
| Hybrid | Standard tools + fast search | Must keep metadata in sync | Yes |

**Binding constraint:** Need both standard tool compatibility (git, editors) AND fast search. Hybrid approach satisfies both.

### Bubblewrap vs. Alternative Sandboxes

**Decision:** Bubblewrap for all code execution on Linux host.

**Alternatives considered:**
1. Docker/Podman containers
2. Language-specific VMs (Pyodide, QuickJS)
3. Bubblewrap (Linux namespaces)

**Analysis:**

| Approach | Isolation | Portability | Overhead | Verdict |
|----------|-----------|-------------|----------|---------|
| Docker | Excellent | Good (cross-platform) | High (~1-2s) | No (too heavy for single-user) |
| Language VMs | Moderate | Excellent | Low (~10ms) | No (limited languages) |
| Bubblewrap | Good | Linux-only | Very Low (~1ms) | Yes |

**Why bubblewrap won:**
- Originally chose Docker for cross-platform (Mac vs Linux)
- Decision to host on Linux removes portability constraint
- Single-user model doesn't need heavy container isolation
- ~1ms overhead vs ~1.5s is significant for interactive use
- Projects as regular directories enables standard tooling (git, editors, etc.)

**Tradeoff:** Linux-only. Acceptable since we're targeting a dedicated Linux server.

### Filesystem Monitoring

**Decision:** inotify via watchdog for automatic change detection.

**Alternatives considered:**
1. Polling - simple but wasteful
2. Model-reported changes - requires model cooperation
3. inotify (via watchdog) - kernel-level, efficient

**Why inotify:**
- Both user and models edit files; can't rely on either reporting changes
- Kernel-level efficiency (~0 CPU when idle)
- watchdog handles recursive watching with debouncing

**Considerations:**
- Debounce write storms (pip install generates hundreds of events)
- Ignore tooling directories (.pyenv, node_modules, .git)
- inotify watch limit may need increasing: `sysctl fs.inotify.max_user_watches=524288`

### Separate Services vs. Monolith

**Decision:** Two services (chat app + indexer daemon) sharing Postgres.

**Why separate:**
- Indexer can restart without affecting active chat sessions
- Can upgrade/modify indexer independently
- Clear separation: chat app handles user interaction, indexer handles background work
- LISTEN/NOTIFY for real-time coordination when chat app creates projects

**Communication:** Shared Postgres database. Indexer watches `projects` table and filesystem. Chat app reads from search index.

## Performance Characteristics

**File operations:**
- Read file (<1MB): ~10-50ms
- Write file: ~20-100ms
- Index file (text, <100KB): ~50-200ms
- Hash computation (SHA256, <1MB): ~5-20ms

**Database operations (Postgres):**
- Insert message metadata: ~5-10ms
- Query conversation messages: ~5-20ms (10-100 messages)
- Full-text search: ~10-100ms (depends on corpus size)
- Vector similarity search: ~5-50ms (with HNSW index)
- Connection pooling handles concurrent requests

**Bubblewrap execution:**
- Sandbox startup: ~1ms
- Command execution: variable (10ms to minutes depending on command)
- No cleanup overhead (process just exits)

**Model API calls:**
- OpenAI (gpt-4o): ~2-10s (depends on prompt length, tool calls)
- Anthropic (Claude Sonnet): ~2-15s
- Variance high: depends on response length, tool iterations

**Total /api/turn latency:**
- No tool calls: ~3-12s (dominated by model API)
- With tool calls (3-5 commands): ~3-15s (model API; sandbox overhead negligible)
- Parallel models: max(model latencies), not sum

**Expected scale:**
- Projects: 1-100 per user
- Files per project: 10-1000 (mostly < 100)
- Conversations per project: 10-100
- Messages per conversation: 10-100 rounds (20-200 messages total)
- Search corpus: 1-10MB text per project

System designed for single user, dedicated Linux server. Should handle up to ~10k files, ~1k conversations without performance degradation.

**Scaling limits:**
- Postgres full-text search: Effective up to ~100MB text. Beyond that, consider dedicated search service.
- Vector search (pgvector): Effective up to ~1M vectors. Beyond that, consider Pinecone/Qdrant.
- Filesystem: Modern filesystems handle millions of files. Not a constraint.
- inotify watches: Default 8192, can increase to 524288. Sufficient for expected scale.

Postgres with pgvector already positioned for scale. No major migrations expected for single-user use.

## Deployment

The three services run on a single Linux host, managed by systemd.

### Installation paths

```
/opt/mm/
  mm-search/           # Search service
    .venv/
    src/
  mm-server/           # Backend API
    .venv/
    src/
  mm-web/              # Static frontend (or served by mm-server)
    src/

/srv/projects/         # Project data (shared)

/etc/mm/
  search.env           # mm-search environment
  server.env           # mm-server environment (API keys)
```

### systemd units

**mm-search.service:**
```ini
[Unit]
Description=Multi-Model Search Service
After=postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=mm
WorkingDirectory=/opt/mm/mm-search
EnvironmentFile=/etc/mm/search.env
ExecStart=/opt/mm/mm-search/.venv/bin/uvicorn src.main:app --host 127.0.0.1 --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**mm-server.service:**
```ini
[Unit]
Description=Multi-Model Chat Server
After=mm-search.service postgresql.service
Requires=postgresql.service
Wants=mm-search.service

[Service]
Type=simple
User=mm
WorkingDirectory=/opt/mm/mm-server
EnvironmentFile=/etc/mm/server.env
ExecStart=/opt/mm/mm-server/.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Environment files:**
```bash
# /etc/mm/search.env
DATABASE_URL=postgresql://mm:password@localhost/mmchat
PROJECTS_ROOT=/srv/projects

# /etc/mm/server.env
DATABASE_URL=postgresql://mm:password@localhost/mmchat
SEARCH_URL=http://127.0.0.1:8001
PROJECTS_ROOT=/srv/projects
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Operations

```bash
# Start services
sudo systemctl start mm-search mm-server

# View logs
journalctl -u mm-server -f

# Restart after code update
sudo systemctl restart mm-search mm-server
```

---

See [ROADMAP.md](ROADMAP.md) for implementation phases and time estimates.
