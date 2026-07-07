# Guidelines for AI Assistants

This document provides instructions for Gemini (or other AI assistants) working on this codebase.

## Project Overview

Multi-model chat system with:
- **Filesystem storage** - Files live in `projects/` directories
- **Docker execution** - Sandboxed code execution
- **Markdown conversations** - Conversation history as .md files
- **Unified search** - FTS5 index across files and conversations

Read [VISION.md](VISION.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first for context.

## Coding Conventions

### JavaScript Style

```javascript
// Node.js 18+, CommonJS modules
const express = require('express');
const { someFunction } = require('./utils');

// 2-space indentation, semicolons
function exampleFunction(param1, param2) {
  if (param1) {
    return param2;
  }
  return null;
}

// Async/await over callbacks
async function fetchData() {
  const result = await db.query('SELECT * FROM table');
  return result;
}

// Descriptive names
const projectId = 'proj-123';          // Good
const pid = 'proj-123';                // Bad

// Single quotes for strings
const message = 'Hello world';
const template = `User ${name} said: ${message}`;
```

### Database Queries

```javascript
// Use better-sqlite3 (synchronous API)
const db = require('better-sqlite3')('storage/data.db');

// Prepared statements
const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
const project = stmt.get(projectId);

// Transactions for multi-step operations
const insertFile = db.transaction((projectId, path, content) => {
  const fileId = newId('file');
  db.prepare('INSERT INTO project_files ...').run(fileId, projectId, path);
  // More operations...
  return fileId;
});
```

### File Operations

```javascript
// Use fs.promises for async file operations
const fs = require('fs').promises;
const path = require('path');

// Always use absolute paths
const projectPath = path.join(PROJECTS_DIR, projectId, 'files');
const filePath = path.join(projectPath, sanitizedPath);

// Create directories recursively
await fs.mkdir(path.dirname(filePath), { recursive: true });

// Write files
await fs.writeFile(filePath, content, 'utf-8');

// Read files
const content = await fs.readFile(filePath, 'utf-8');
```

### Error Handling

```javascript
// Use try-catch for async operations
try {
  const result = await someAsyncOperation();
  return result;
} catch (err) {
  console.error('Operation failed:', err);
  throw new Error(`Failed to complete operation: ${err.message}`);
}

// Return error objects in API responses
res.status(500).json({
  error: 'operation_failed',
  message: err.message,
  details: err.stack  // Only in development
});
```

## Project Structure

### Key Directories

```
server/
  db/           - Database schema, migrations, connection
  adapters/     - Model provider APIs (OpenAI, Anthropic, etc.)
  execution/    - Docker execution management
  conversations/- Read/write conversation .md files
  indexing/     - FTS5 search, chunking
  files/        - File storage management
  prompts/      - System prompt construction
  utils/        - Shared utilities

projects/       - USER DATA (gitignored)
  {project-id}/
    files/      - Project workspace (user accessible)

storage/        - SQLite database
```

### Configuration

```javascript
// Environment variables in .env (gitignored)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

// Access via process.env
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY not set');
}

// Store app config in database
const config = db.prepare('SELECT value FROM config WHERE key = ?')
  .get('system_prompts');
```

## Common Patterns

### ID Generation

```javascript
// Use ULID or timestamp-based IDs
function newId(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const projectId = newId('proj');  // proj_abc123_def456
const fileId = newId('file');
```

### Path Sanitization

```javascript
// Always sanitize user-provided paths
function sanitizePath(userPath) {
  // Remove leading slashes
  let clean = userPath.replace(/^\/+/, '');

  // Prevent directory traversal
  if (clean.includes('..') || clean.includes('~')) {
    throw new Error('Invalid path: directory traversal not allowed');
  }

  // Normalize
  return path.normalize(clean);
}
```

### Content Hashing

```javascript
const crypto = require('crypto');

function hashContent(content) {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
}

// Use for change detection
const newHash = hashContent(fileContent);
const oldHash = db.prepare('SELECT content_hash FROM project_files WHERE id = ?')
  .get(fileId).content_hash;

if (newHash !== oldHash) {
  // File changed, reindex
}
```

### Markdown with Frontmatter

```javascript
function formatMarkdownWithFrontmatter(frontmatter, content) {
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (typeof value === 'object') {
        return `${key}:\n${Object.entries(value)
          .map(([k, v]) => `  ${k}: ${v}`) 
          .join('\n')}`;
      }
      return `${key}: ${value}`;
    })
    .join('\n');

  return `---\n${yaml}\n---\n\n${content}`;
}

function parseMarkdownWithFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const [, yamlStr, body] = match;
  const frontmatter = parseSimpleYAML(yamlStr);  // Implement basic YAML parser

  return { frontmatter, body };
}
```

## What to Do

### ✅ Good Practices

- **Read existing code** before implementing new features
- **Write tests** for each new function/endpoint
- **Update documentation** when changing APIs or architecture
- **Use existing patterns** (follow established conventions)
- **Commit atomic changes** (one feature/fix per commit)
- **Add comments** for non-obvious logic
- **Validate inputs** from users and external APIs
- **Handle errors gracefully** with clear messages
- **Log important operations** with context

### Example Test Pattern

```javascript
// server/test-something.js
const { db } = require('./db');
const { someFunction } = require('./module');

async function runTests() {
  console.log('=== Testing Something ===\n');

  // Setup
  const testId = newId('test');

  try {
    // Test 1
    console.log('1. Testing basic operation...');
    const result = await someFunction(testId);

    if (result.success) {
      console.log('✓ Basic operation works');
    } else {
      console.error('✗ Basic operation failed:', result);
      process.exit(1);
    }

    // Test 2
    console.log('\n2. Testing edge case...');
    // ...

    console.log('\n✓ All tests passed!');

  } finally {
    // Cleanup
    db.prepare('DELETE FROM table WHERE id = ?').run(testId);
  }
}

runTests().catch(err => {
  console.error('Tests failed:', err);
  process.exit(1);
});
```

## What NOT to Do

### ❌ Anti-Patterns

- **Don't store file content in database** - Use filesystem
- **Don't store conversation content in database** - Use .md files
- **Don't use Pyodide** - Use Docker
- **Don't use long-running containers** - Use ephemeral `docker run --rm`
- **Don't install packages in container** - Install in project directory (.venv, node_modules)
- **Don't duplicate data** - Single source of truth (files or DB, not both)
- **Don't expose API keys** to browser
- **Don't trust user input** - Validate and sanitize
- **Don't commit .env** or projects/ directory
- **Don't use async database operations** with better-sqlite3 (it's synchronous)

## Testing

### Running Tests

```bash
# Test specific module
node server/test-schema.js
node server/test-file-apis.js
node server/test-conversations.js

# Test end-to-end (requires server running)
npm start  # Terminal 1
node server/test-e2e.js  # Terminal 2

# Manual API testing
curl -X POST http://localhost:3000/api/turn \
  -H 'Content-Type: application/json' \
  -d '{"userMessage": "Hello", "targetModels": [{"provider": "openai", "modelId": "gpt-4o"}]}' \
  | jq
```

### What to Test

- **Database operations** - Can create/read/update/delete
- **File operations** - Can upload/read/delete files
- **Conversation operations** - Can create conversations, save messages
- **Search** - Can index and search files and conversations
- **Execution** - Can run bash commands in Docker
- **End-to-end** - Full workflow from user message to model response

## Docker

### Building Image

```bash
cd server/execution
docker build -t multimodelchat-executor .
```

### Testing Execution

```bash
# Test container manually
docker run --rm \
  -v $(pwd)/projects/test-project/files:/project:rw \
  -w /project \
  --memory 1g \
  --cpus 2.0 \
  multimodelchat-executor \
  bash -c "python3 -m venv .venv && source .venv/bin/activate && pip install pandas && python -c 'import pandas; print(pandas.__version__)'"
```

## Debugging

### Common Issues

**"Cannot find module"**
→ Run `npm install`

**"SQLITE_BUSY" or "database is locked"**
→ Close other connections, use WAL mode: `db.pragma('journal_mode = WAL')`

**"Docker command not found"**
→ Install Docker Desktop

**"Permission denied" accessing projects/ files**
→ Check file permissions, Docker volume mounts

**"File not found" when reading conversation**
→ Check file path is correct, message was actually saved


### Debug Logging

```javascript
// Enable debug logging
const DEBUG = process.env.DEBUG === 'true';

function debug(...args) {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

// Usage
debug('Executing command:', command);
debug('Project path:', projectPath);
```

Run with: `DEBUG=true npm start`

## Getting Help

### Documentation to Read

1. **This project:**
   - [VISION.md](VISION.md) - Goals and principles
   - [ARCHITECTURE.md](ARCHITECTURE.md) - Technical design
   - [ROADMAP.md](ROADMAP.md) - Implementation plan
   - [specs/](specs/) - Step-by-step guides

2. **External:**
   - [better-sqlite3 docs](https://github.com/WiseLibs/better-sqlite3)
   - [SQLite FTS5 docs](https://www.sqlite.org/fts5.html)
   - [Docker CLI reference](https://docs.docker.com/engine/reference/commandline/cli/)
   - [Express.js docs](https://expressjs.com/)

### Useful Commands

```bash
# Check database schema
sqlite3 storage/data.db ".schema"

# Query database
sqlite3 storage/data.db "SELECT * FROM projects"

# Check Docker containers
docker ps -a

# View project files
ls -la projects/*/files/

# Search project files
grep -r "search term" projects/*/files/

# Check file size
du -sh projects/*/files/
```

## Implementation Priority

When implementing from scratch, follow the [ROADMAP.md](ROADMAP.md) order:

1. **Step 01** - Database schema (foundation for everything)
2. **Step 02** - File storage (needed for execution)
3. **Step 03** - Conversations (needed for /api/turn)
4. **Step 04** - Docker execution (needed for tools)
5. **Step 05** - Tool integration (core feature)
6. **Step 06** - Search (makes system useful)
7. **Step 07** - System prompts (polish)
8. **Step 08** - UI (user experience)

Each step has a detailed spec in `specs/` with success criteria and code examples.

Good luck! 🚀
