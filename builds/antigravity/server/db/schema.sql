CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings TEXT,              -- JSON: Docker config, volumes, model prefs, etc.
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,      -- "user" or "agent:<model-id>"
  file_path TEXT NOT NULL,    -- ".conversations/conv-123/rounds/001-user.md"
  model_id TEXT,              -- "gpt-4o", "claude-sonnet-4-5", etc.
  provider TEXT,              -- "openai", "anthropic", etc.
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX idx_messages_round ON conversation_messages(conversation_id, round_number);

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

CREATE VIRTUAL TABLE retrieval_index USING fts5(
  chunk_id UNINDEXED,
  project_id UNINDEXED,
  content,                    -- Full-text searchable content
  metadata UNINDEXED,         -- JSON: source info, context
  tokenize='porter unicode61'
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,        -- JSON value
  updated_at INTEGER NOT NULL
);
