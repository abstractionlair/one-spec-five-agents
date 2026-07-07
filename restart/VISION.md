# Vision: Multi-Model Chat

## What

I want two sets of things.
1. AI chat comparable to the official apps from frontier labs, but with multiple models at once, and control over the kinds of parameters offered by APIs.
2. Go beyond those interfaces in a couple of ways.
    1. Support for conversations longer than context windows. (I just read that compaction is about to come to Claude chat.)
    2. Rather than "Projects" or "Gems", flexible use of a filesystem sandbox with searching and RAG-inspired idea.

## Many-to-Many Conversations: The Roundtable Model

The core differentiator: **models see each other's responses**, creating a roundtable discussion rather than isolated parallel chats.

**How it works:**

Each "turn" is organized into rounds:
1. User sends a message
2. All selected models respond **in parallel**
3. Each model's response is collected into the same round
4. On the next turn, each model sees what **other models said** (not just the user)

**Example - Round 1:**
```
User: What are the pros and cons of microservices?

[GPT-4]: Microservices offer scalability and independent deployment, but introduce...
[Claude]: The microservices pattern trades monolith simplicity for...
[Gemini]: From an architectural perspective, microservices provide...
```

**What Claude sees in Round 2** (after user asks "Which approach do you recommend?"):
```
User: What are the pros and cons of microservices?
[GPT-4]: Microservices offer scalability and independent deployment, but introduce...
[Gemini]: From an architectural perspective, microservices provide...

User: Which approach do you recommend?
```

Note: Claude sees GPT-4 and Gemini's responses, but not its own (that becomes the `assistant` role in Claude's context).

**Why this matters:**

- **Cross-pollination**: Models can build on, disagree with, or synthesize each other's ideas
- **Comparison**: User sees multiple perspectives on the same question
- **Specialization**: Different models can play different roles (analyst, implementer, critic)
- **Consensus-building**: Models can converge on answers through discussion

This is fundamentally different from running three separate chats. It's one conversation with multiple participants.  
  
## Proposed Architecture

Project-aware orchestration system running on a Linux server with three key properties:

**1. Filesystem as Source of Truth**

Projects live in standard filesystem directories (e.g. `projects/{project-id}/`). This includes 
- conversations (in Markdown or JSON)
- "project files" in the sense of Claude or OpenAI Projects or "knowledge" in the case og Gemini Gems
- tools as-in [Code Execution with MCP](inspiration/Code-execution-with-MCP-building.md), [Code Mode](inspiration/Code-Mode-the-better-way-to-use.md)
Models read and write files directly and can execute them.
This includes executing commands to manage a development environment within the project.
Files are indexed for search (via a tool available to the models) and for RAG-like functionality built into the orchestration system.

This enables:
- Standard tooling (editors, git, grep)
- Version control of conversations and generated code
- Direct inspection without proprietary formats
- Portability (copy directory = copy entire project)
vironment.

**2. Sandboxed Code Execution**

Models execute bash commands in bubblewrap sandboxes with project directory mounted read-write. Sandboxes use Linux namespaces for isolation (PID, network, filesystem).

Key decision: Bubblewrap over Docker. With a dedicated Linux server, container overhead (~1-2s startup) was unnecessary. Bubblewrap provides ~1ms startup via direct namespace isolation. Models install packages into project-local environments (.venv, .pyenv, node_modules) which persist on host filesystem.
This simplifies lifecycle management. No daemon, no images, no container state. Each execution is independent. Packages persist where they belong (in project directory). Projects are regular directories visible to standard tools.

**3. Unified Search Index**

Postgres with pgvector for hybrid search:
- Full-text search (keyword matching via tsvector)
- Vector similarity search (semantic matching via embeddings)
- Project files (code, docs, data)
- Conversation messages
- Model-generated scripts

Same search interface returns ranked results from all sources. Models can reference past discussions when answering new questions.

Example query: "authentication flow"
Results:
- `src/auth.js:45-67` (implementation)
- `docs/auth.md` (documentation)
- `.conversations/conv-5/rounds/003-gpt-4o.md` (past discussion)

This enables models to build on previous work rather than re-deriving solutions.

## Design Constraints

**Storage:**
- Files on filesystem, not database blobs (enables standard tools)
- Postgres for metadata, search index, and vector embeddings
- Conversations as markdown (human-readable, git-compatible)

**Execution:**
- Bubblewrap for sandboxing (Linux namespaces, ~1ms overhead)
- Ephemeral processes (stateless execution)
- Project-local environments (.venv, .pyenv, node_modules persist on host)

**Search:**
- Postgres full-text search + pgvector (hybrid keyword + semantic)
- Auto-indexing via inotify file watching (watchdog)
- Local embeddings via Qwen3-Embedding-0.6B (sentence-transformers)
- Unified index (single search interface)

**Models:**
- Parallel execution (compare responses)
- Provider-agnostic adapters (extensible architecture)
  - Current: OpenAI, Anthropic
  - Planned: Google Gemini, xAI Grok
  - Future: DeepSeek, MiniMax, Qwen, Z.ai, Kimi, Mistral, open-source via Ollama
- Tool-calling support (bash execution)

## Success Criteria

Operationally, the system succeeds when:

1. **Context scaling:** Project tokens exceed model context limits. Search maintains sub-second query latency and returns relevant results in top-10.

2. **Tool reuse:** Models generate utilities (data parsers, test frameworks) that get invoked in later conversations without re-implementation.

3. **Conversation references:** Models cite specific past discussions (by conversation ID and round number) when answering questions.

4. **Version control:** Users commit entire projects (code + conversations) to git. Conversations tracked alongside implementation.

5. **Daily use:** System handles real development workflows without manual workarounds or data export/import.

Quantifiable: p95 search latency < 1s, 80%+ conversation references resolve correctly, 90%+ model-generated code executes without manual fixes.

## Explicit Non-Goals

Scope boundaries:

**Not building:**
- Real-time streaming responses (batched responses acceptable)
- Web-based code editor (users have editors)
- Multi-user collaboration (single-user first, multi-user has coordination complexity)
- Model training or fine-tuning (use existing APIs)
- Image/video generation (text + code focus)
- Mobile interface (desktop/web only)

**Rationale:** Each non-goal either adds UI complexity (streaming, editor), coordination complexity (multi-user), or is orthogonal to core value proposition (image generation, mobile). Start simple.

## Phased Implementation

**Phase 1: Local, single-user**
- Postgres persistence (metadata + search + vectors)
- Filesystem storage (files + markdown conversations)
- Bubblewrap execution (bash tool)
- Hybrid search (FTS + pgvector)
- Basic web UI (project/conversation management)
- Indexer daemon (inotify file watching)

**Phase 2: Enhanced features**
- Automatic context retrieval (search-based)
- Conversation summarization (fractal/hierarchical)
- Cost tracking (token usage by model/project)
- UI improvements (syntax highlighting, markdown rendering)

**Phase 3: Multi-user** (future, after Phase 2 validates single-user)
- Hosted service (auth, multi-tenancy)
- Shared projects (access control)
- Real-time updates (if needed)

## Design Philosophy

Three principles:

**1. Simple First, Then Evolve**

Start with minimal viable implementation, evolve when constraints justify:
- Postgres with pgvector (needed for vector search + concurrent access)
- Filesystem (not S3) — direct access, standard tools
- Bubblewrap (lighter, faster on dedicated Linux host)
- Markdown or JSON (not custom format)

Add complexity only when simplicity creates measurable constraints. The evolution from SQLite/Docker to Postgres/Bubblewrap came from committing to a dedicated Linux server.

**2. Standard Tools**

Leverage existing developer workflows:
- `.venv`, `.pyenv`, and `node_modules` for package management
- Git for version control
- Markdown for documentation
- Postgres for data (standard SQL, psql access)
- Linux namespaces via bubblewrap (standard kernel features)

Avoid novel formats or workflows. Users already know these tools.

**3. Explicit Ownership**

Users control data:
- Files on local filesystem (not cloud-only)
- Open formats (markdown, JSON, Postgres)
- No vendor lock-in (can read/export without tool)
- Direct editing (files editable outside system)
- Standard database tools (psql, pg_dump)

This enables trust. Users can inspect, modify, delete data without reverse-engineering proprietary formats.

## Analogies

**From distributed systems:** This is a stateful orchestrator (persistent working directory) not stateless RPC (ephemeral queries). Conversations are checkpoints in a long-running computation.

**From software development:** Projects are git repositories. Conversations are commit history. Search is blame/log. Models are collaborating developers with different specializations.

**From economics:** Models are agents with heterogeneous capabilities. Parallel execution is a market mechanism—multiple bids on the same problem. User selects best response (revealed preference).

## Related Work

Prior approaches and how this differs:

**Jupyter Notebooks:** Persistent computational environment, but single kernel. No multi-model orchestration. No conversation search.

**Anthropic Code Execution:** Tool use framework. This implements specific tool (bash) with project context and multi-model support.

**Aider:** Git-integrated AI pair programming. Single model, no parallel execution. No conversation search across projects.

**Continue.dev:** IDE-integrated assistant. Single model, IDE-dependent. No standalone project management.

This system combines: multi-model (like ensemble methods), persistent context (like Jupyter), version control (like Aider), and searchable history (novel).

## Decided: Implementation Choices

**Three-project architecture:** System split into independent projects with HTTP interfaces.

| Project | Language | Purpose |
|---------|----------|---------|
| mm-search | Python | File watcher, indexer, embeddings, search API |
| mm-server | Python | Backend API, conversations, adapters, sandbox |
| mm-web | JavaScript | Frontend UI |

- **Why split:** Minimize cognitive load for humans and AI agents. Each project fits in one context window. Different tooling (Python vs JS) in separate repos. HTTP APIs force explicit, well-designed contracts.
- **Communication:** mm-web → mm-server via REST (openapi.yaml). mm-server → mm-search via REST.
- **Deployment:** systemd services on Linux host. See ARCHITECTURE.md for details.

**Backend:** Python 3.12+ with FastAPI, asyncpg, aiofiles. Rationale: Python is more familiar to maintainer and has excellent AI/ML ecosystem.

**Embeddings (v1):** Local Qwen3-Embedding-0.6B via sentence-transformers (1024-dim vectors).
- **Why local:** No API dependency, no per-query cost, works offline, fast (~10ms per chunk on CPU)
- **Hardware:** CPU-only is sufficient at expected scale (<100k chunks). GPU optional for faster bulk indexing.
- **Future option:** OpenAI text-embedding-3-small if quality issues arise or for hosted deployment. Would require schema change (different dimensions) so deferring.

**Frontend:** Vanilla JavaScript (no framework).

**File watching:** watchdog (Python inotify wrapper).

## Open Questions

**Search ranking:** BM25 default + vector cosine similarity. Hybrid search combines both with weighted scoring. Might need re-ranking by recency or conversation context. Measure precision@10 in real use.

**Cost management:** Token usage unbounded with large projects and long conversations. Need budget limits or compression (summarization).

**Conversation pruning:** Step 09 implements context management with summarization. Automatic truncation with summary preservation handles conversations exceeding context windows.

**Multi-model coordination:** Currently independent parallel queries. Could models coordinate (one model analyzes, another implements)? Adds complexity. Defer until single-model workflow validated.

These questions have empirical answers. Build Phase 1, use it, measure, then decide.

---

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and component interactions.
