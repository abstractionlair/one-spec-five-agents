# Vision: Multi-Model Chat

## What

I want to two sets of thigs.
1. AI chat comparable to the official apps from frontier labs, but with multiple models at once, and control over the kinds of paramaters offered by APIs.
2. Go beyond those interfaces in a couple of ways.
    1. Support for conversations longer than context windows. (I just read that compaction is about to come to Claude.)
    2. Rather than "Projects" or "Gems", flexible use of a filesystem sandbox with seasrching and RAG-inspired idea.
    
## Proposed Architecture

Project-aware orchestration system with three key properties:

**1. Filesystem as Source of Truth**

Projects live in standard filesystem directories (`projects/{project-id}/files/`). Models read and write files directly. Conversations stored as markdown files with YAML frontmatter. Database tracks metadata only (hashes, timestamps, references).

This enables:
- Standard tooling (editors, git, grep)
- Version control of conversations and generated code
- Direct inspection without proprietary formats
- Portability (copy directory = copy entire project)

Tradeoff: Requires filesystem access. Cannot run purely in-browser or stateless cloud environment.

**2. Sandboxed Code Execution**

Models execute bash commands in ephemeral Docker containers with project directory mounted read-write. Containers run with resource limits (memory, CPU, timeout) and network isolation.

Key decision: Ephemeral containers (`docker run --rm`) not long-running containers. Models install packages into project-local environments (.venv, node_modules) which persist on host filesystem across container invocations.

This simplifies lifecycle management. No container state to track. Each execution is independent. Packages persist where they belong (in project directory, not container).

Tradeoff: ~1-2s container startup overhead per command. Acceptable for interactive use. Can optimize later with container pooling if needed.

**3. Unified Search Index**

Single FTS5 index for:
- Project files (code, docs, data)
- Conversation messages
- Model-generated scripts

Same search interface returns ranked results from all sources. Models can reference past discussions when answering new questions.

Example query: "authentication flow"
Results:
- `src/auth.js:45-67` (implementation)
- `docs/auth.md` (documentation)
- `.conversations/conv-5/rounds/003-agent-<model-id>.md` (past discussion)

This enables models to build on previous work rather than re-deriving solutions.

## Design Constraints

**Storage:**
- Files on filesystem, not database blobs (enables standard tools)
- Database for metadata and search index only
- Conversations as markdown (human-readable, git-compatible)

**Execution:**
- Docker for sandboxing (cross-platform, resource limits)
- Ephemeral containers (stateless execution)
- Project-local environments (packages persist on host)

**Search:**
- SQLite FTS5 (embedded, no external service)
- Auto-indexing on file/message creation
- Unified index (single search interface)

**Models:**
- Parallel execution (compare responses)
- Provider-agnostic adapters (OpenAI, Anthropic, Google)
- Tool-calling support (bash execution)

## Success Criteria

Operationally, the system succeeds when:

1. **Context scaling:** Projects exceed 200k tokens. Search maintains sub-second query latency and returns relevant results in top-10.

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

**Phase 1: Local, single-user** (~25-30 hours implementation)
- SQLite persistence (metadata + search)
- Filesystem storage (files + markdown conversations)
- Docker execution (bash tool)
- FTS5 search (unified index)
- Basic web UI (project/conversation management)

**Phase 2: Enhanced features** (future)
- Automatic context retrieval (search-based)
- Conversation summarization (fractal/hierarchical)
- Cost tracking (token usage by model/project)
- UI improvements (syntax highlighting, markdown rendering)

**Phase 3: Multi-user** (future, after Phase 2 validates single-user)
- Hosted service (auth, multi-tenancy)
- Shared projects (access control)
- Real-time updates (if needed)

Constraint: Phase 2 starts only after Phase 1 demonstrates value in daily use. Phase 3 starts only if multi-user demand justifies coordination complexity.

## Design Philosophy

Three principles:

**1. Simple First**

Start with minimal viable implementation:
- SQLite (not Postgres) — embedded, zero-config
- Filesystem (not S3) — direct access, standard tools
- Docker (not custom sandbox) — cross-platform isolation
- Markdown (not custom format) — human-readable, tool-compatible

Add complexity only when simplicity creates measurable constraints.

**2. Standard Tools**

Leverage existing developer workflows:
- `.venv` and `node_modules` for package management
- Git for version control
- Markdown for documentation
- Docker for sandboxing

Avoid novel formats or workflows. Users already know these tools.

**3. Explicit Ownership**

Users control data:
- Files on local filesystem (not cloud-only)
- Open formats (markdown, JSON, SQLite)
- No vendor lock-in (can read/export without tool)
- Direct editing (files editable outside system)

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

## Open Questions

**Search ranking:** BM25 default. Might need re-ranking by recency or conversation context. Measure precision@10 in real use.

**Cost management:** Token usage unbounded with large projects and long conversations. Need budget limits or compression (summarization).

**Conversation pruning:** Infinite message history will exceed context windows. When/how to summarize or truncate?

**Multi-model coordination:** Currently independent parallel queries. Could models coordinate (one model analyzes, another implements)? Adds complexity. Defer until single-model workflow validated.

These questions have empirical answers. Build Phase 1, use it, measure, then decide.

---

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and component interactions.
