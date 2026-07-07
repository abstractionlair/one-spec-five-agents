# Implementation Specifications

This directory contains detailed, step-by-step implementation guides for building the Multi-Model Chat system.

## Overview

Each specification is designed to be implemented independently with clear:
- **Goal** - What you're building
- **Complexity** - Time estimate
- **Dependencies** - What must be done first
- **Implementation** - Complete code examples
- **Tests** - Verification scripts
- **Success Criteria** - Checklist of requirements

## Specifications

### Phase 1: Foundation

#### [01. Project Setup & SQLite Schema](01-project-setup-and-schema.md)
**Complexity:** Low (2-3 hours) | **Dependencies:** None

Set up the database with all tables, migrations, and basic CRUD operations for projects and config.

**Key Deliverables:**
- SQLite database with complete schema
- Migration system
- Project management functions
- Test script

---

#### [02. Filesystem Storage & File APIs](02-filesystem-storage.md)
**Complexity:** Medium (3-4 hours) | **Dependencies:** Step 01

Implement file storage on the filesystem with metadata tracking in the database.

**Key Deliverables:**
- File upload/read/delete APIs
- Project directory structure
- Content hashing for change detection
- Path sanitization

---

#### [03. Conversations as Markdown Files](03-conversations-as-files.md)
**Complexity:** Medium (3-4 hours) | **Dependencies:** Step 01

Store conversation messages as markdown files with YAML frontmatter.

**Key Deliverables:**
- Markdown writer with frontmatter
- Markdown parser
- Conversation APIs
- Message persistence

---

### Phase 2: Execution

#### [04. Docker Execution Environment](04-docker-execution.md)
**Complexity:** Medium (3-4 hours) | **Dependencies:** Step 02

Set up sandboxed code execution using Docker containers.

**Key Deliverables:**
- Dockerfile with Python, Node.js, and package managers
- Docker execution wrapper
- Resource limits and timeout handling
- Network control

---

#### [05. Tool Integration in /api/turn](05-tool-integration.md)
**Complexity:** High (4-6 hours) | **Dependencies:** Steps 03, 04

Integrate bash execution as a tool in the main conversation endpoint.

**Key Deliverables:**
- Model adapters with tool support (OpenAI, Anthropic)
- Tool calling loop
- Bash tool definition
- Multi-model parallel execution

---

### Phase 3: Search & Polish

#### [06. Unified Search (FTS5)](06-unified-search.md)
**Complexity:** Medium (3-4 hours) | **Dependencies:** Steps 02, 03

Build full-text search across files and conversations using SQLite FTS5.

**Key Deliverables:**
- Content chunking
- FTS5 indexing
- Search API with ranking
- Auto-indexing on file/message creation

---

#### [07. System Prompts & Context](07-system-prompts.md)
**Complexity:** Low (2-3 hours) | **Dependencies:** Steps 05, 06

Create rich system prompts with project context and tool instructions.

**Key Deliverables:**
- Prompt templates by provider
- File listing in prompts
- Bash tool usage examples
- Environment setup guidance

---

#### [08. UI & Testing](08-ui-and-testing.md)
**Complexity:** Medium (3-4 hours) | **Dependencies:** Step 07

Build a functional web interface and comprehensive end-to-end tests.

**Key Deliverables:**
- Web UI (HTML/CSS/JS)
- Project/conversation management
- File upload interface
- Search UI
- End-to-end integration test

---

## Implementation Order

Follow the roadmap order for best results:

```
01 → 02 → 04 → 05 → 07 → 08
  ↘  03 ↗  ↘  06 ↗
```

**Parallelization opportunities:**
- Steps 02 and 03 can be done in parallel after Step 01
- Step 06 can start once either Step 02 or 03 is complete

## Time Estimates

- **Phase 1 (Foundation):** 8-11 hours
- **Phase 2 (Execution):** 7-10 hours
- **Phase 3 (Search & Polish):** 8-11 hours

**Total:** ~23-32 hours for complete implementation

## Testing Strategy

Each step includes:
1. **Unit tests** - Individual function testing
2. **Integration tests** - API endpoint testing
3. **Success criteria** - Verification checklist

Run tests incrementally:
```bash
# After each step
node server/test-<step-name>.js

# Final validation
node server/test-e2e.js
```

## Getting Help

- **Stuck?** Check "Common Issues" section in each spec
- **Questions?** Refer to [ARCHITECTURE.md](../ARCHITECTURE.md) for design decisions
- **Context?** See [VISION.md](../VISION.md) for goals and principles

## Quick Reference

### File Structure
```
server/
  db/              # Step 01
  files/           # Step 02
  conversations/   # Step 03
  execution/       # Step 04
  adapters/        # Step 05
  indexing/        # Step 06
  prompts/         # Step 07
  server.js        # Steps 05, 06, 07

web/               # Step 08
  index.html
  app.js
  styles.css
```

### Key Technologies
- **Database:** SQLite + better-sqlite3
- **Server:** Node.js + Express
- **Execution:** Docker
- **Search:** SQLite FTS5
- **AI Models:** OpenAI SDK, Anthropic SDK

### Environment Setup
```bash
cp .env.example .env
# Add API keys

npm install
npm start
```

---

**Ready to start?** Begin with [01. Project Setup & SQLite Schema](01-project-setup-and-schema.md)

**Need context first?** Read [ARCHITECTURE.md](../ARCHITECTURE.md) and [VISION.md](../VISION.md)
