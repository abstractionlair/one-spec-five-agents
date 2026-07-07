# Implementation Roadmap

## Overview

This roadmap breaks down the implementation into **8 concrete steps**, each scoped to one focused PR.

```
Phase 1: Foundation (Steps 1-3)
├─ 01: Project setup & SQLite schema
├─ 02: Filesystem storage & file APIs
└─ 03: Conversations as markdown files

Phase 2: Execution (Steps 4-5)
├─ 04: Docker execution environment
└─ 05: Tool integration in /api/turn

Phase 3: Search & Polish (Steps 6-9)
├─ 06: Unified search (FTS5)
├─ 07: System prompts & context
├─ 08: UI & testing
└─ 09: Conversation context management
```

## Dependency Graph

```mermaid
graph TD
    01[01: Setup] --> 02[02: File Storage]
    01 --> 03[03: Conversations]
    02 --> 06[06: Search]
    03 --> 06
    02 --> 04[04: Docker Execution]
    04 --> 05[05: Tool Integration]
    03 --> 05
    06 --> 07[07: System Prompts]
    05 --> 07
    07 --> 08[08: UI & Testing]
```

## Phase 1: Foundation

### Step 01: Project Setup & SQLite Schema
**Goal:** Database schema, migrations, basic project/config management

**Complexity:** Low (2-3 hours)

**Deliverables:**
- SQLite database with schema (projects, files metadata, conversations metadata, config)
- Migration system
- Basic CRUD for projects and config
- Test script verifying schema

**Files:**
- `server/db/schema.sql`
- `server/db/index.js`
- `server/db/migrations.js`
- `server/db/test-schema.js`

**Success Criteria:**
- [ ] Database created with all tables
- [ ] Can create/read/update projects
- [ ] Can store/retrieve config
- [ ] Test script passes

---

### Step 02: Filesystem Storage & File APIs
**Goal:** Store files on filesystem, track metadata in DB, basic file upload/read

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 01

**Deliverables:**
- Project directory creation (`projects/{project-id}/files/`)
- File upload API (writes to filesystem + DB metadata)
- File read API (reads from filesystem)
- File listing API
- Hash-based change detection

**Files:**
- `server/files/storage.js`
- `server/files/routes.js`
- `server/utils/hash.js`
- `server/test-file-apis.js`

**Endpoints:**
- `POST /api/projects/:id/files` - Upload file
- `GET /api/projects/:id/files/:fileId` - Get file content
- `GET /api/projects/:id/files` - List files
- `DELETE /api/projects/:id/files/:fileId` - Delete file

**Success Criteria:**
- [ ] Can upload file via API
- [ ] File written to `projects/{id}/files/{path}`
- [ ] Metadata stored in `project_files` table
- [ ] Can read file content
- [ ] Can list all files in project
- [ ] Hash verification works

---

### Step 03: Conversations as Markdown Files
**Goal:** Save conversation messages as .md files, track metadata in DB

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 01

**Deliverables:**
- Conversation creation (creates `.conversations/{conv-id}/` directory)
- Message writer (saves to .md with YAML frontmatter)
- Message reader (parses .md files)
- Conversation listing/retrieval APIs

**Files:**
- `server/conversations/writer.js`
- `server/conversations/reader.js`
- `server/conversations/routes.js`
- `server/test-conversations.js`

**Endpoints:**
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/:id` - Get conversation with messages
- `GET /api/conversations?projectId=X` - List conversations

**Message Format (example using a provider model):**
```markdown
---
id: msg-abc123
speaker: agent:<model-id>
model: <model-id>          # e.g. the provider's latest stable GPT‑4‑class model
round: 1
timestamp: 2025-01-15T10:30:00Z
usage:
  input_tokens: 1250
  output_tokens: 432
---

Message content here...
```

**Success Criteria:**
- [ ] Can create conversation
- [ ] Can save user message to .md file
- [ ] Can save agent message to .md file
- [ ] Can read conversation with all messages
- [ ] Metadata correctly parsed from frontmatter
- [ ] Can list all conversations for project

---

## Phase 2: Execution

### Step 04: Docker Execution Environment
**Goal:** Execute bash commands in sandboxed Docker containers

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 02 (needs project directories)

**Deliverables:**
- Dockerfile for execution environment
- Docker command executor
- Project directory mounting
- Timeout and resource limits
- Test suite for execution

**Files:**
- `server/execution/Dockerfile`
- `server/execution/docker.js`
- `server/execution/test-docker.js`

**Docker Image (base example):**
```dockerfile
FROM ubuntu:latest  # or the latest Ubuntu LTS available on your system
RUN apt-get update && apt-get install -y \
  python3 python3-pip python3-venv \
  nodejs npm \
  curl wget git \
  build-essential
# Install pixi for environment management
RUN curl -fsSL https://pixi.sh/install.sh | bash
```

**Execution API:**
```javascript
executeBash(command, projectId, options)
  → {stdout, stderr, exit_code}
```

**Success Criteria:**
- [ ] Docker image builds successfully
- [ ] Can execute simple bash commands
- [ ] Project directory correctly mounted
- [ ] Can create files in project directory
- [ ] Can run Python scripts
- [ ] Can run Node.js scripts
- [ ] Timeout protection works
- [ ] Can create .venv and install packages

**Example Commands:**
```bash
# Create Python venv
python3 -m venv .venv

# Install packages
source .venv/bin/activate && pip install pandas

# Run script
source .venv/bin/activate && python analyze.py

# Use pixi (Python 3.x)
pixi init && pixi add python=3.x pandas
pixi run python script.py

# npm
npm install lodash
node script.js
```

---

### Step 05: Tool Integration in /api/turn
**Goal:** Integrate bash tool into conversation endpoint, enable model code execution

**Complexity:** High (4-6 hours)

**Dependencies:** Steps 03, 04

**Deliverables:**
- Model provider adapters with tool support (OpenAI, Anthropic, Google)
- Bash tool definition
- Tool calling loop in /api/turn
- Basic /api/turn endpoint (without search context yet)

**Files:**
- `server/adapters/openai.js`
- `server/adapters/anthropic.js`
- `server/adapters/google.js`
- `server/execution/tools.js`
- `server/server.js` (main routes)
- `server/test-turn.js`

**Tool Definition:**
```javascript
{
  name: "bash",
  description: "Execute bash commands in project directory",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Bash command to execute"
      }
    },
    required: ["command"]
  }
}
```

**Tool Calling Loop:**
```javascript
1. Send message to model with tools
2. If model calls bash tool:
   a. Execute in Docker
   b. Return results to model
   c. Model generates final response
3. Save final response to conversation
```

**Success Criteria:**
- [ ] Can send message to single model
- [ ] Model can call bash tool
- [ ] Bash tool executes in Docker
- [ ] Tool results returned to model
- [ ] Model generates final response
- [ ] Response saved to .conversations/.../rounds/
- [ ] Works with multiple models in parallel
- [ ] Multi-turn tool calling works (model can call bash multiple times)

---

## Phase 3: Search & Polish

### Step 06: Unified Search (FTS5)
**Goal:** Index files and conversations, enable search across both

**Complexity:** Medium (3-4 hours)

**Dependencies:** Steps 02, 03

**Deliverables:**
- Chunking logic (split files into searchable chunks)
- Indexer (files → chunks → FTS5)
- Conversation indexer
- Search API
- Auto-indexing on file upload and message creation

**Files:**
- `server/indexing/chunker.js`
- `server/indexing/indexer.js`
- `server/indexing/search.js`
- `server/test-search.js`

**Indexing Pipeline:**
```
1. File uploaded or message created
2. Read content from filesystem
3. Split into chunks (~50 lines or ~500 tokens)
4. Insert into content_chunks table
5. Insert into FTS5 retrieval_index
```

**Search API:**
```javascript
POST /api/projects/:id/search
{
  "query": "authentication flow",
  "limit": 10,
  "filters": {
    "fileTypes": [".js", ".md"],
    "includeConversations": true
  }
}

→ Returns ranked results from files AND conversations
```

**Success Criteria:**
- [ ] Can index a file
- [ ] Can index a conversation message
- [ ] Can search and get results from files
- [ ] Can search and get results from conversations
- [ ] Results ranked by relevance
- [ ] Auto-indexing on file upload works
- [ ] Auto-indexing on message creation works
- [ ] Can filter by file type

---

### Step 07: System Prompts & Context
**Goal:** Build rich system prompts with project context, file listings, search results

**Complexity:** Low (2-3 hours)

**Dependencies:** Steps 05, 06

**Deliverables:**
- System prompt builder
- Project context assembly (file list, conversation info)
- Instructions for bash tool usage
- Instructions for creating environments

**Files:**
- `server/prompts/builder.js`
- `server/prompts/templates.js`

**System Prompt Structure:**
```
You are {modelId} in a multi-model conversation.

PROJECT CONTEXT:
Working in "{projectName}" project.

BASH EXECUTION:
You have access to bash in a Docker container.
Working directory: /project/
Create environments: python3 -m venv .venv
Install packages: source .venv/bin/activate && pip install pandas
Or use pixi: pixi init && pixi add python=3.x pandas

PROJECT FILES ({count} total):
- data/sales.csv (1.2KB)
- scripts/analyze.py (450B)
- README.md (2.1KB)

CONVERSATION:
This is round {roundNumber} of the conversation.
{summary if available}

[Provider-specific instructions]
```

**Success Criteria:**
- [ ] System prompt includes project name
- [ ] System prompt includes file listing
- [ ] System prompt includes bash instructions
- [ ] System prompt includes conversation context
- [ ] Different prompts for different providers (OpenAI vs Anthropic)

---

### Step 08: UI & Testing
**Goal:** Basic web UI, end-to-end testing, documentation

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 07

**Deliverables:**
- Web UI for sending messages and viewing responses
- Project/conversation selector
- File upload interface
- Search interface
- End-to-end test suite
- User documentation

**Files:**
- `web/index.html`
- `web/app.js`
- `web/styles.css`
- `server/test-e2e.js`
- `QUICKSTART.md`

**UI Features:**
- Select project
- Select models to query
- Send message
- View responses from each model
- Upload files
- Search files/conversations
- View conversation history

**E2E Test:**
```javascript
1. Create project
2. Upload data file
3. Send message: "Analyze the data"
4. Verify model called bash tool
5. Verify results displayed
6. Search for "analyze"
7. Verify search finds both file and conversation
```

**Success Criteria:**
- [ ] Can select project in UI
- [ ] Can select target models
- [ ] Can send message and see responses
- [ ] Can upload files via UI
- [ ] Can search via UI
- [ ] Can view conversation history
- [ ] E2E test passes
- [ ] Documentation complete

---

### Step 09: Conversation Context Management
**Goal:** Implement conversation summarization and pruning to handle conversations exceeding context windows

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 05 (Tool integration), Step 07 (System prompts)

**Deliverables:**
- Context-aware message retrieval (automatic truncation)
- Conversation summarization using models
- Summary storage in conversation metadata
- Token counting and threshold detection
- API endpoints for manual summarization
- Integration with prompt builder

**Files:**
- `server/conversations/context.js`
- `server/conversations/summarizer.js`
- `server/test-context.js`
- Updated `server/prompts/builder.js`

**Success Criteria:**
- [ ] Can estimate conversation token count
- [ ] Can detect when summarization is needed
- [ ] Can create summaries using models
- [ ] Summaries stored in conversation settings
- [ ] Prompt builder includes summaries
- [ ] Truncation notices added to system prompt
- [ ] Test script passes

---

## Implementation Strategy

### Parallelization Opportunities

**Steps 02 and 03 can be done in parallel** after Step 01:
- 02 (File Storage) is independent of 03 (Conversations)
- Both depend only on 01 (Database Schema)

**Step 06 can start after 02 or 03 completes:**
- Doesn't need both to be done
- Can test with just files or just conversations first

### Testing Approach

Each step includes:
1. **Unit tests** - Test individual functions
2. **Integration tests** - Test API endpoints
3. **Manual smoke test** - Test via curl or test script

### Migration from Current Codebase

The current implementation has Phase 1a and 1b complete but with different architecture:
- **Reuse:** Database migration system, basic route structure, adapter patterns
- **Replace:** File storage (DB → filesystem), execution (Pyodide → Docker)
- **New:** Conversations as files, unified search

**Migration Strategy:**
1. Implement new system in parallel (don't modify existing code)
2. Write migration script to move existing conversations to new format
3. Cut over when new system reaches feature parity
4. Archive old code

---

## Current Status

🚧 **Not Started** - Ready to begin with Step 01

## Estimated Timeline

- **Phase 1 (Foundation):** 8-11 hours (Steps 01-03)
- **Phase 2 (Execution):** 7-10 hours (Steps 04-05)
- **Phase 3 (Search & Polish):** 11-15 hours (Steps 06-09)

**Total: ~26-36 hours** for complete implementation (including context management)

**Core functionality (Steps 01-08): ~23-32 hours**

Working in focused 3-4 hour sessions, this is **7-12 sessions** to completion.

---

**Previous:** [ARCHITECTURE.md](ARCHITECTURE.md) | **Next:** [specs/](specs/) for detailed implementation guides
