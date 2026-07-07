# Multi-Model Chat

A production-ready multi-model chat system that lets you query multiple AI models simultaneously, with filesystem storage, Docker-based code execution, and persistent conversation history.

## ⚡ Quick Note: Node.js 20 Required

This project requires **Node.js 20 LTS** (not Node 24) due to better-sqlite3 compilation requirements.

```bash
nvm use 20  # Or: nvm alias default 20
```

## Features

- 🤖 **Multi-Model Queries** - Send messages to multiple AI models (OpenAI, Anthropic) and compare responses
- 💻 **Code Execution** - Models can execute bash commands in sandboxed Docker containers
- 📁 **Filesystem Storage** - Files and conversations as actual files, not database BLOBs
- 📝 **Markdown Conversations** - Human-readable conversation history with YAML frontmatter
- 🔧 **Tool Calling** - Models can install packages, analyze data, create files, run scripts
- 📊 **Usage Tracking** - Track token usage for cost management
- 🔒 **Sandboxed Execution** - Docker containers with resource limits
- 🔍 **FTS5 Search Ready** - Full-text search capability with better-sqlite3

## Quick Start

```bash
# 1. Switch to Node 20
nvm use 20

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Add your API keys to .env

# 4. Start server
npm start

# 5. Open http://localhost:3000
```

See [QUICKSTART.md](QUICKSTART.md) for detailed instructions.

## Project Status

✅ **Implemented (Steps 1-5, 7-8):**
- Database schema with better-sqlite3 and FTS5
- Filesystem storage for files
- Markdown-based conversation storage  
- Docker execution environment
- Tool integration with bash execution
- OpenAI and Anthropic adapters
- System prompt builder with project context
- Web UI for multi-model queries

🚀 **Ready to Implement:**
- Step 6: Unified Search - FTS5 tables created, needs indexing logic

⏸️ **Future:**
- Step 9: Conversation Context Management

## Architecture

```
projects/{project-id}/
  files/
    .venv/              # Python virtualenv (models create)
    node_modules/       # npm packages (models install)
    .conversations/     # Markdown conversation history
      {conv-id}/
        rounds/
          001-user.md
          001-agent-gpt-4o.md
    data/               # User data files
    scripts/            # Model-generated code
```

**Key Design Decisions:**
- **Filesystem Storage** - Direct access enables standard tools
- **Docker Execution** - Isolation with resource limits
- **Ephemeral Containers** - Stateless execution
- **Markdown Conversations** - Human-readable, version-controllable
- **better-sqlite3** - Native performance with FTS5

## Documentation

- [QUICKSTART.md](QUICKSTART.md) - Get started in 5 minutes
- [BETTER_SQLITE3_SUCCESS.md](BETTER_SQLITE3_SUCCESS.md) - How we fixed compilation
- [VISION.md](VISION.md) - Project goals and design principles  
- [ARCHITECTURE.md](ARCHITECTURE.md) - Technical architecture
- [ROADMAP.md](ROADMAP.md) - Implementation phases
- [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) - Details and limitations

## Requirements

- **Node.js 20 LTS** (not Node 24!) - Required for better-sqlite3
- Docker (optional, for bash tool execution)
- API Keys: OpenAI and/or Anthropic

## Testing

All tests pass with Node 20:

```bash
npm run test:schema          # Database tests ✅
npm run test:files           # File storage tests ✅
npm run test:conversations   # Conversation tests ✅
npm run test:docker          # Docker tests (requires Docker)
```

## Technology Stack

- **Backend**: Node.js 20 + Express  
- **Database**: SQLite (better-sqlite3) with FTS5
- **Storage**: Filesystem for files and conversations
- **Execution**: Docker containers (ephemeral, resource-limited)
- **Models**: OpenAI, Anthropic (extendable)

## Performance

With better-sqlite3 (vs sql.js):
- ~100x faster database operations
- Native code performance
- Proper transaction support
- FTS5 full-text search

## License

MIT
