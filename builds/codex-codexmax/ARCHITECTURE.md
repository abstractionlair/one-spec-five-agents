# Architecture

## Component DAG

```
Browser (Static HTML/JS)
    │
    │ HTTP (REST)
    ▼
Express Server (Node.js)
    │
    ├──────┬──────┬──────┬──────┐
    │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼
 Routes Adapters Exec Convs Search
    │      │      │      │      │
    ├──────┴──────┴──────┴──────┤
    │                            │
    ▼                            ▼
SQLite (Metadata + FTS5)    Filesystem (Content)
                                │
                                ▼
                        Docker (Sandboxed Exec)
```

**Key insight:** Database stores metadata (references, hashes, indices). Filesystem stores content (files, conversations). This separation enables standard tooling while maintaining search performance.

## Directory Structure

```
server/
  server.js              # Express routes, orchestration
  adapters/
    openai.js            # OpenAI API + tool calling
    anthropic.js         # Anthropic API + tool calling
    google.js            # Google API + tool calling
  db/
    index.js             # SQLite connection (better-sqlite3)
    schema.sql           # Table definitions
    migrations.js        # Schema versioning
  execution/
    docker.js            # Container lifecycle (spawn, --rm)
    tools.js             # Tool definitions (bash)
  conversations/
    writer.js            # Message → markdown file
    reader.js            # Markdown file → parsed message
  indexing/
    chunker.js           # Text → chunks (~500 tokens)
    indexer.js           # Chunks → content_chunks + FTS5
    search.js            # FTS5 query interface
  prompts/
    builder.js           # System prompt construction

web/
  index.html             # Static UI
  app.js                 # Client-side JS

projects/                # Gitignored
  {project-id}/
    files/
      .venv/             # Python virtualenv
      node_modules/      # npm packages
      .conversations/    # Markdown conversations
        {conv-id}/
          rounds/
            001-user.md
            001-agent-{model}.md
      data/              # User data
      scripts/           # Model-generated code

storage/
  data.db                # SQLite (metadata + search index)
```

## Data Flow: /api/turn

Request arrives:
```javascript
POST /api/turn
{
  userMessage: "Analyze sales data",
  targetModels: [{provider: "openai", modelId: "<openai-model-id>"}],
  conversationId: "conv-123",
  projectId: "proj-456"
}
```

**Execution DAG:**

```
1. Save user message
   └─> Write to .conversations/{conv-id}/rounds/{N}-user.md
   └─> Insert metadata to conversation_messages table
   └─> Index message in FTS5

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
   │   ├─> Docker container spawned:
   │   │   docker run --rm \
   │   │     -v {projectPath}:/project:rw \
   │   │     --memory 1g --cpus 2.0 \
   │   │     multimodelchat-executor \
   │   │     bash -c "{command}"
   │   ├─> Results (stdout, stderr, exit_code) → model
   │   └─> Model generates final response
   │
   └─> Save agent message
       └─> Write to .conversations/{conv-id}/rounds/{N}-agent-{model}.md
       └─> Insert metadata to conversation_messages table
       └─> Index message in FTS5

3. Return responses
   └─> Array of {modelId, text, usage, toolCallsMade}
```

**Parallel execution:** Each model queries independently. No shared state except project filesystem (read-write safe—models don't typically conflict).

**Latency breakdown (typical):**
- Message save: ~10-50ms
- System prompt build: ~5-10ms
- Model API call: ~1-10s (depends on model, prompt length, tool use)
- Docker execution per command: ~1.5-3s (startup ~1-2s, execution variable)
- Message index: ~50-200ms
- Total: ~2-15s per model (dominated by API call + Docker)

## Database Schema

### Metadata Tables

**projects** — Container for files and conversations
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- proj_{timestamp}_{random}
  name TEXT NOT NULL,
  settings TEXT,                    -- JSON: {allow_network, additional_volumes, ...}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**project_files** — File metadata (content on filesystem)
```sql
CREATE TABLE project_files (
  id TEXT PRIMARY KEY,              -- file_{timestamp}_{random}
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,               -- Relative: "data/sales.csv"
  content_hash TEXT,                -- SHA256(file content)
  mime_type TEXT,
  size_bytes INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, path)
);
-- Physical location: projects/{project_id}/files/{path}
```

**Change detection:** Hash stored in DB. On file read, compute hash. If mismatch, file changed → re-index.

**conversations** — Conversation metadata
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,              -- conv_{timestamp}_{random}
  project_id TEXT NOT NULL,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

**conversation_messages** — Message metadata (content in .md files)
```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,              -- msg_{timestamp}_{random}
  conversation_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,    -- User + all agents = 1 round
  speaker TEXT NOT NULL,            -- "user" or "agent:{model-id}"
  file_path TEXT NOT NULL,          -- ".conversations/{conv-id}/rounds/001-user.md"
  model_id TEXT,                    -- NULL for user, model ID for agents
  provider TEXT,                    -- "openai", "anthropic", etc.
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
-- Physical location: projects/{project_id}/files/{file_path}
```

**Message file format (example):**
```markdown
---
id: msg_abc123_def456
speaker: agent:<model-id>
model: <model-id>
provider: <provider-name>      # e.g. openai, anthropic
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

### Search Tables

**content_chunks** — Chunked content for indexing
```sql
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- "file" or "conversation_message"
  source_id TEXT NOT NULL,          -- Foreign key to project_files or conversation_messages
  project_id TEXT NOT NULL,
  chunk_index INTEGER,              -- 0, 1, 2, ... for multi-chunk sources
  content TEXT NOT NULL,
  location TEXT,                    -- JSON: {path, start_line, end_line} or {conv_id, round, speaker}
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_chunks_source ON content_chunks(source_type, source_id);
CREATE INDEX idx_chunks_project ON content_chunks(project_id);
```

**Chunking strategy:** Files split on line boundaries, ~50 lines or ~500 tokens per chunk. Conversations: one chunk per message (messages typically < 500 tokens).

**retrieval_index** — FTS5 full-text search
```sql
CREATE VIRTUAL TABLE retrieval_index USING fts5(
  chunk_id UNINDEXED,               -- References content_chunks.id
  project_id UNINDEXED,             -- For filtering
  content,                          -- Searchable text
  metadata UNINDEXED,               -- JSON: {type, path/conv_id, ...}
  tokenize = 'porter unicode61'
);
```

**Search query:**
```sql
SELECT
  chunk_id,
  bm25(retrieval_index) as rank,
  snippet(retrieval_index, 2, '<mark>', '</mark>', '...', 32) as snippet
FROM retrieval_index
WHERE retrieval_index MATCH ?
  AND project_id = ?
ORDER BY rank
LIMIT ?;
```

BM25 ranking built into FTS5. Snippet extraction with highlighting.

## Docker Execution Model

**Container lifecycle:** Ephemeral (`docker run --rm`). Each bash command spawns fresh container, executes, terminates.

**Why ephemeral vs. long-running?**
- Stateless: No container state to manage. No cleanup logic.
- Simpler: `spawn()` call, wait for exit, done.
- Isolation: Each execution independent. No state leakage between commands.

**Tradeoff:** ~1-2s startup overhead. Acceptable for interactive use. If this becomes binding constraint (unlikely—model API calls dominate latency), can add container pooling without architectural changes.

**Container configuration:**
```javascript
docker run --rm \
  -v {absoluteProjectPath}:/project:rw \  // Project directory mounted
  -w /project \                           // Working directory
  --memory 1g \                           // Memory limit
  --cpus 2.0 \                            // CPU limit
  --network bridge \                      // Network (or 'none' to isolate)
  multimodelchat-executor \               // Image with Python, Node, tools
  bash -c "{command}"                     // Command to execute
```

**Project-local environments:** Models install packages to .venv, node_modules, .pixi within /project. These directories persist on host filesystem across container invocations.

See inspiration/Code-execution-with-MCP-building.md and inspiration/Code-Mode-the-better-way-to-use.md for some background on why we chose this simple code and tool execution design.
The situations aren't perfectly comparable, but these influenced the choices.

Example:
```bash
# First command: Create venv
docker run ... bash -c "python3 -m venv .venv"
# .venv/ now exists in projects/{id}/files/.venv on host

# Second command: Use venv
docker run ... bash -c "source .venv/bin/activate && pip install pandas"
# Packages installed to .venv/lib on host

# Third command: Run code
docker run ... bash -c "source .venv/bin/activate && python analyze.py"
# Uses packages from .venv on host
```

**Security properties:**
- Filesystem isolation: Container can only access /project (mounted volume). No access to host / filesystem.
- Resource limits: Memory and CPU capped. Prevents runaway processes.
- Network control: By default containers run with network enabled (`--network bridge`) so models can install packages and fetch data. Per-project settings can disable network entirely (`--network none`) or add restrictions.
- Timeout: Commands killed after timeout (default 60s). Prevents infinite loops.

**Additional volumes (optional):**
Projects can specify additional mounts in settings:
```json
{
  "additional_volumes": [
    {
      "host_path": "/Users/<user>/Documents/data",
      "mount_path": "/external/data",
      "readonly": true
    }
  ]
}
```

Enables models to read shared datasets without copying into project.

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

**Concurrency:** Models queried in parallel via `Promise.all()`. Responses arrive independently.

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
3. If text file, indexed automatically (chunks → FTS5)

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
| Filesystem only | Simple, standard tools | No fast metadata queries, no FTS5 | No |
| Hybrid | Standard tools + fast search | Must keep metadata in sync | Yes |

**Binding constraint:** Need both standard tool compatibility (git, editors) AND fast search. Hybrid approach satisfies both.

### Docker vs. Alternative Sandboxes

**Decision:** Docker for all code execution.

**Alternatives considered:**
1. OS-level sandboxing (chroot, firejail, sandbox-exec)
2. Language-specific VMs (Pyodide, QuickJS)
3. Docker

**Analysis:**

| Approach | Isolation | Portability | Overhead | Verdict |
|----------|-----------|-------------|----------|---------|
| OS sandbox | Good | Poor (OS-specific) | Low (~10ms) | No (portability) |
| Language VMs | Moderate | Excellent | Low (~10ms) | No (limited languages) |
| Docker | Excellent | Good (requires Docker) | High (~1-2s) | Yes |

**Constraint:** Need Python + Node.js + arbitrary packages. Language VMs can't satisfy this. Docker overhead acceptable (model API calls dominate latency).

### Ephemeral vs. Long-Running Containers

**Decision:** Ephemeral containers (`docker run --rm`).

**Tradeoff:** 1-2s startup overhead per command vs. container lifecycle complexity.

**Breakeven analysis:**
- Ephemeral: ~1.5s average per command (startup + cleanup)
- Long-running: ~0.1s per command (exec into running container), but lifecycle management cost
- Typical conversation: 3-5 bash commands per model response
- Latency difference: ~4-7s per conversation round
- Model API call latency: ~3-10s

Startup overhead is <50% of total latency. Not binding constraint. Simplicity wins.

**Future optimization:** If startup becomes bottleneck (>90% conversations have >10 bash calls), add container pooling without API changes:
```javascript
// Keep containers alive for recent projects
const pool = new Map(); // projectId -> {containerId, lastUsed}

async function executeBash(command, projectId) {
  const cached = pool.get(projectId);
  if (cached && (now() - cached.lastUsed < 60000)) {
    return dockerExec(cached.containerId, command);  // Fast path
  }
  return dockerRun(command, projectId);              // Slow path
}
```

Defer until measurements justify complexity.

## Performance Characteristics

**File operations:**
- Read file (<1MB): ~10-50ms
- Write file: ~20-100ms
- Index file (text, <100KB): ~50-200ms
- Hash computation (SHA256, <1MB): ~5-20ms

**Database operations:**
- Insert message metadata: ~5-10ms
- Query conversation messages: ~5-20ms (10-100 messages)
- FTS5 search: ~10-100ms (depends on corpus size)
- SQLite with WAL mode: ~1000s of operations/sec

**Docker execution:**
- Container startup: ~1-2s
- Command execution: variable (10ms to minutes depending on command)
- Container cleanup (--rm): ~100-200ms

**Model API calls (typical GPT‑4/Claude‑class models):**
- OpenAI (GPT‑4‑class chat model): ~2-10s (depends on prompt length, tool calls)
- Anthropic (Claude‑class model): ~2-15s
- Variance high: depends on response length, tool iterations

**Total /api/turn latency:**
- No tool calls: ~3-12s (dominated by model API)
- With tool calls (3-5 commands): ~8-25s (model API + Docker)
- Parallel models: max(model latencies), not sum

**Expected scale:**
- Projects: 1-100 per user
- Files per project: 10-1000 (mostly < 100)
- Conversations per project: 10-100
- Messages per conversation: 10-100 rounds (20-200 messages total)
- Search corpus: 1-10MB text per project

System designed for single user, local execution. Should handle up to ~10k files, ~1k conversations without performance degradation.

**Scaling limits:**
- FTS5 search: Effective up to ~100MB text. Beyond that, response time increases linearly.
- SQLite: WAL mode handles high concurrency. Single writer bottleneck not relevant (single user).
- Filesystem: Modern filesystems handle millions of files. Not a constraint.

**If scaling limits hit:**
- Search: Switch to Elasticsearch or embeddings-based search
- Database: Shard by project or migrate to Postgres
- Filesystem: Use object storage (S3) with local cache

Defer these until measurements show necessity.

---

See [ROADMAP.md](ROADMAP.md) for implementation phases and time estimates.
