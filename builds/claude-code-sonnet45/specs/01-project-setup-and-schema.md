# Step 01: Project Setup & SQLite Schema

> **Note:** This guide uses generic placeholders for model IDs. When implementing, use the current production model names from each provider.

**Goal:** Set up the database schema, migrations system, and basic project/config management.

**Complexity:** Low (2-3 hours)

**Dependencies:** None (first step)

## Overview

This step establishes the data layer foundation. We'll create:
1. SQLite database with all tables
2. Migration system for schema evolution
3. Basic CRUD operations for projects and config
4. Test script to verify everything works

## Database Schema

### Tables

#### projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings TEXT,              -- JSON: Docker config, volumes, model prefs, etc.
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Notes:**
- `settings` stores JSON like:
  ```json
  {
    "allow_network": true,
    "additional_volumes": [...],
    "model_config": {
      "temperature": 0.7,
      "max_tokens": 4096,
      "top_p": 1.0
    }
  }
  ```
- `id` uses format: `proj_<timestamp>_<random>`

#### project_files
```sql
CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,         -- Relative path: "data/sales.csv"
  content_hash TEXT,          -- SHA256 for change detection
  mime_type TEXT,
  size_bytes INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, path)
);

CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_files_path ON project_files(path);

-- Full-text search on file paths for filename search
CREATE VIRTUAL TABLE project_files_path_fts USING fts5(
  file_id UNINDEXED,
  project_id UNINDEXED,
  path,
  content='project_files',
  content_rowid='rowid'
);
```

**Notes:**
- NO `content` column (files live on filesystem)
- `content_hash` used to detect changes for re-indexing
- `path` is relative to `projects/{project-id}/files/`

#### conversations
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings TEXT,              -- JSON: summaries, preferences, etc.
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
```

**Notes:**
- `settings` stores conversation-specific metadata like summaries:
  ```json
  {
    "summary": {
      "upToRound": 10,
      "content": "Summary text...",
      "createdAt": 1234567890,
      "messageCount": 20
    }
  }
  ```

#### conversation_messages
```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,      -- "user" or "agent:<model-id>"
  file_path TEXT NOT NULL,    -- ".conversations/conv-123/rounds/001-user.md"
  model_id TEXT,              -- Model identifier from provider (e.g., "openai-flagship", "anthropic-flagship")
  provider TEXT,              -- "openai", "anthropic", etc.
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX idx_messages_round ON conversation_messages(conversation_id, round_number);
```

**Notes:**
- NO `content` column (messages stored as .md files)
- `file_path` is relative to project directory
- Token counts for cost tracking

#### content_chunks
```sql
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,  -- "file" or "conversation_message"
  source_id TEXT NOT NULL,    -- ID of file or message
  project_id TEXT NOT NULL,
  chunk_index INTEGER,        -- 0, 1, 2, ... for multi-chunk sources
  content TEXT NOT NULL,      -- The actual chunk content
  location TEXT,              -- JSON: file path, line range, or round info
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_chunks_source ON content_chunks(source_type, source_id);
CREATE INDEX idx_chunks_project ON content_chunks(project_id);
```

#### retrieval_index (FTS5)
```sql
CREATE VIRTUAL TABLE retrieval_index USING fts5(
  chunk_id UNINDEXED,
  project_id UNINDEXED,
  content,                    -- Full-text searchable content
  metadata UNINDEXED,         -- JSON: source info, context
  tokenize='porter unicode61'
);
```

**Notes:**
- FTS5 provides full-text search
- `chunk_id` references `content_chunks.id`
- `metadata` stores searchable context (file type, speaker, etc.)

#### config
```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,        -- JSON value
  updated_at INTEGER NOT NULL
);
```

**Notes:**
- Store app-wide settings (system prompts, defaults, etc.)
- Values are JSON strings

## File Structure

```
server/
  db/
    index.js           # Database connection, initialization
    schema.sql         # Complete schema definition
    migrations.js      # Migration system
    projects.js        # CRUD for projects
    config.js          # CRUD for config
    test-schema.js     # Test script

storage/
  data.db              # SQLite database file (gitignored)
```

## Implementation

### 1. Database Connection (server/db/index.js)

```javascript
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../storage/data.db');

// Ensure storage directory exists
const storageDir = path.dirname(DB_PATH);
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Connect to database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Enable foreign keys
db.pragma('foreign_keys = ON');

module.exports = { db };
```

### 2. Schema (server/db/schema.sql)

Put the complete schema from above in this file.

### 3. Migrations (server/db/migrations.js)

```javascript
const { db } = require('./index');
const fs = require('fs');
const path = require('path');

function getCurrentVersion() {
  try {
    const result = db.prepare('SELECT value FROM config WHERE key = ?')
      .get('schema_version');
    return result ? parseInt(JSON.parse(result.value)) : 0;
  } catch (err) {
    return 0;
  }
}

function setVersion(version) {
  const stmt = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `);
  const now = Date.now();
  const value = JSON.stringify(version);
  stmt.run('schema_version', value, now, value, now);
}

function runMigrations() {
  const currentVersion = getCurrentVersion();
  console.log(`Current schema version: ${currentVersion}`);

  // Migration 1: Initial schema
  if (currentVersion < 1) {
    console.log('Running migration 1: Initial schema...');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );

    // Execute schema (split by semicolons for better-sqlite3)
    const statements = schemaSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      db.exec(statement);
    }

    setVersion(1);
    console.log('✓ Migration 1 complete');
  }

  console.log('All migrations complete');
}

module.exports = { runMigrations };
```

### 4. Project CRUD (server/db/projects.js)

```javascript
const { db } = require('./index');

function newId(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createProject(name, description = '', settings = {}) {
  const id = newId('proj');
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO projects (id, name, description, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, name, description, JSON.stringify(settings), now, now);

  return getProject(id);
}

function getProject(id) {
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const project = stmt.get(id);

  if (!project) return null;

  // Parse settings JSON
  if (project.settings) {
    project.settings = JSON.parse(project.settings);
  }

  return project;
}

function listProjects() {
  const stmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
  const projects = stmt.all();

  return projects.map(p => ({
    ...p,
    settings: p.settings ? JSON.parse(p.settings) : {}
  }));
}

function updateProject(id, updates) {
  const project = getProject(id);
  if (!project) throw new Error('Project not found');

  const { name, description, settings } = updates;
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE projects
    SET name = ?, description = ?, settings = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    name || project.name,
    description !== undefined ? description : project.description,
    JSON.stringify(settings || project.settings),
    now,
    id
  );

  return getProject(id);
}

function deleteProject(id) {
  const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

module.exports = {
  newId,
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject
};
```

### 5. Config CRUD (server/db/config.js)

```javascript
const { db } = require('./index');

function getConfig(key) {
  const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const result = stmt.get(key);

  if (!result) return null;

  try {
    return JSON.parse(result.value);
  } catch (err) {
    return result.value;
  }
}

function setConfig(key, value) {
  const now = Date.now();
  const jsonValue = JSON.stringify(value);

  const stmt = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `);

  stmt.run(key, jsonValue, now, jsonValue, now);
}

function deleteConfig(key) {
  const stmt = db.prepare('DELETE FROM config WHERE key = ?');
  const result = stmt.run(key);
  return result.changes > 0;
}

function listConfig() {
  const stmt = db.prepare('SELECT key, value FROM config');
  const rows = stmt.all();

  const config = {};
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch (err) {
      config[row.key] = row.value;
    }
  }

  return config;
}

module.exports = {
  getConfig,
  setConfig,
  deleteConfig,
  listConfig
};
```

### 6. Test Script (server/db/test-schema.js)

```javascript
const { db } = require('./index');
const { runMigrations } = require('./migrations');
const {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject
} = require('./projects');
const {
  getConfig,
  setConfig,
  listConfig,
  deleteConfig
} = require('./config');

async function runTests() {
  console.log('=== Testing Database Schema ===\n');

  try {
    // Run migrations
    console.log('1. Running migrations...');
    runMigrations();
    console.log('✓ Migrations complete\n');

    // Test projects
    console.log('2. Testing project CRUD...');

    const project = createProject(
      'Test Project',
      'A test project',
      { allow_network: true }
    );
    console.log('  Created project:', project.id);

    const retrieved = getProject(project.id);
    if (!retrieved) throw new Error('Failed to retrieve project');
    console.log('  ✓ Can retrieve project');

    const updated = updateProject(project.id, { name: 'Updated Project' });
    if (updated.name !== 'Updated Project') {
      throw new Error('Failed to update project');
    }
    console.log('  ✓ Can update project');

    const projects = listProjects();
    if (projects.length === 0) throw new Error('No projects listed');
    console.log('  ✓ Can list projects');

    // Test config
    console.log('\n3. Testing config CRUD...');

    setConfig('test_key', { value: 'test' });
    console.log('  ✓ Can set config');

    const configValue = getConfig('test_key');
    if (!configValue || configValue.value !== 'test') {
      throw new Error('Failed to retrieve config');
    }
    console.log('  ✓ Can get config');

    const allConfig = listConfig();
    if (!allConfig.test_key) throw new Error('Config not in list');
    console.log('  ✓ Can list config');

    deleteConfig('test_key');
    if (getConfig('test_key')) throw new Error('Failed to delete config');
    console.log('  ✓ Can delete config');

    // Test foreign keys
    console.log('\n4. Testing foreign keys...');

    // Insert a file record
    db.prepare(`
      INSERT INTO project_files (id, project_id, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('file_test', project.id, 'test.txt', Date.now(), Date.now());

    // Delete project should cascade
    deleteProject(project.id);

    const fileExists = db.prepare('SELECT * FROM project_files WHERE id = ?')
      .get('file_test');

    if (fileExists) throw new Error('Cascade delete failed');
    console.log('  ✓ Foreign key cascade works');

    console.log('\n✅ All tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
```

## Running

```bash
# Initialize database and run tests
node server/db/test-schema.js
```

## Success Criteria

- [ ] Database created at `storage/data.db`
- [ ] All tables exist with correct schema
- [ ] Can create and retrieve projects
- [ ] Can update and delete projects
- [ ] Can set and get config values
- [ ] Foreign key constraints work (cascade delete)
- [ ] WAL mode enabled
- [ ] Test script passes all checks

## Common Issues

**"Database is locked"**
→ Make sure WAL mode is enabled: `db.pragma('journal_mode = WAL')`

**"Foreign key constraint failed"**
→ Ensure foreign keys are enabled: `db.pragma('foreign_keys = ON')`

**Migration runs multiple times**
→ Check that `schema_version` is being set correctly in config table

## Next Steps

After this step completes:
- **Step 02:** Add filesystem storage for project files
- **Step 03:** Add conversation message storage as markdown files

---

**Previous:** [ROADMAP.md](../ROADMAP.md) | **Next:** [02-filesystem-storage.md](02-filesystem-storage.md)
