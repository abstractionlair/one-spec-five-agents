-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Project files metadata (content on filesystem)
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_path ON project_files(path);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

-- Conversation messages metadata (content in .md files)
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  file_path TEXT NOT NULL,
  model_id TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_round ON conversation_messages(conversation_id, round_number);

-- Content chunks for search indexing
CREATE TABLE IF NOT EXISTS content_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  chunk_index INTEGER,
  content TEXT NOT NULL,
  location TEXT,
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_source ON content_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON content_chunks(project_id);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_index USING fts5(
  chunk_id UNINDEXED,
  project_id UNINDEXED,
  content,
  metadata UNINDEXED,
  tokenize='porter unicode61'
);

-- Application configuration
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
