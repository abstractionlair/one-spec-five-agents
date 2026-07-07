# Step 06: Unified Search (FTS5)

**Goal:** Index files and conversations for full-text search across all project content.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 02 (File storage), Step 03 (Conversations)

## Overview

Build a unified search system that indexes:
- Project files (code, docs, data)
- Conversation messages
- Auto-indexes on creation/update

Search returns ranked results from both sources.

## Architecture

```
File Created/Updated
       │
       ▼
  ┌─────────┐
  │ Chunker │ Split into ~500 token chunks
  └────┬────┘
       │
       ▼
  ┌──────────┐
  │ Indexer  │ Insert into content_chunks + FTS5
  └──────────┘

Search Query
       │
       ▼
  ┌────────┐
  │  FTS5  │ Full-text search
  └───┬────┘
      │
      ▼
  Results (files + conversations)
```

## File Structure

```
server/
  indexing/
    chunker.js     # Split content into chunks
    indexer.js     # Index chunks in FTS5
    search.js      # Search API
  test-search.js   # Integration tests
```

## Implementation

### 1. Chunker (server/indexing/chunker.js)

```javascript
/**
 * Estimate tokens in text (rough approximation)
 * ~4 characters per token for English
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks of ~maxTokens
 * Tries to split on natural boundaries (lines)
 */
function chunkText(text, maxTokens = 500) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      // Chunk is full, save it
      chunks.push({
        content: currentChunk.join('\n'),
        token_count: currentTokens
      });

      currentChunk = [line];
      currentTokens = lineTokens;
    } else {
      currentChunk.push(line);
      currentTokens += lineTokens;
    }
  }

  // Save remaining
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      token_count: currentTokens
    });
  }

  return chunks;
}

/**
 * Split content by lines for line-based results
 */
function chunkByLines(text, linesPerChunk = 50) {
  const lines = text.split('\n');
  const chunks = [];

  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const chunkLines = lines.slice(i, i + linesPerChunk);
    chunks.push({
      content: chunkLines.join('\n'),
      start_line: i + 1,
      end_line: i + chunkLines.length,
      token_count: estimateTokens(chunkLines.join('\n'))
    });
  }

  return chunks;
}

module.exports = {
  estimateTokens,
  chunkText,
  chunkByLines
};
```

### 2. Indexer (server/indexing/indexer.js)

```javascript
const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');
const { newId } = require('../db/projects');
const { getProjectPath } = require('../files/storage');
const { chunkByLines, estimateTokens } = require('./chunker');
const { parseMarkdown } = require('../conversations/reader');

/**
 * Index a project file
 */
async function indexFile(fileId) {
  // Get file metadata
  const file = db.prepare('SELECT * FROM project_files WHERE id = ?').get(fileId);
  if (!file) throw new Error('File not found');

  // Read content
  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);
  const content = await fs.readFile(fullPath, 'utf-8');

  // Delete existing chunks and index entries for this file
  db.prepare(`
    DELETE FROM retrieval_index
    WHERE chunk_id IN (
      SELECT id FROM content_chunks
      WHERE source_type = ? AND source_id = ?
    )
  `).run('file', fileId);

  db.prepare(`
    DELETE FROM content_chunks
    WHERE source_type = ? AND source_id = ?
  `).run('file', fileId);

  // Chunk content
  const chunks = chunkByLines(content, 50);

  // Insert chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = newId('chunk');

    // Insert into content_chunks
    db.prepare(`
      INSERT INTO content_chunks (
        id, source_type, source_id, project_id, chunk_index,
        content, location, token_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunkId,
      'file',
      fileId,
      file.project_id,
      i,
      chunk.content,
      JSON.stringify({
        file_path: file.path,
        start_line: chunk.start_line,
        end_line: chunk.end_line
      }),
      chunk.token_count,
      Date.now()
    );

    // Insert into FTS5 index
    db.prepare(`
      INSERT INTO retrieval_index (chunk_id, project_id, content, metadata)
      VALUES (?, ?, ?, ?)
    `).run(
      chunkId,
      file.project_id,
      chunk.content,
      JSON.stringify({
        type: 'file',
        file_path: file.path,
        mime_type: file.mime_type
      })
    );
  }

  return chunks.length;
}

/**
 * Index a conversation message
 */
async function indexMessage(messageId) {
  // Get message metadata
  const message = db.prepare('SELECT * FROM conversation_messages WHERE id = ?')
    .get(messageId);
  if (!message) throw new Error('Message not found');

  // Get conversation to find project
  const conv = db.prepare('SELECT project_id FROM conversations WHERE id = ?')
    .get(message.conversation_id);

  // Read message file
  const projectPath = getProjectPath(conv.project_id);
  const fullPath = path.join(projectPath, message.file_path);
  const markdown = await fs.readFile(fullPath, 'utf-8');
  const { content } = parseMarkdown(markdown);

  // Delete existing chunk and index entry for this message
  db.prepare(`
    DELETE FROM retrieval_index
    WHERE chunk_id IN (
      SELECT id FROM content_chunks
      WHERE source_type = ? AND source_id = ?
    )
  `).run('conversation_message', messageId);

  db.prepare(`
    DELETE FROM content_chunks
    WHERE source_type = ? AND source_id = ?
  `).run('conversation_message', messageId);

  // Create single chunk for message
  const chunkId = newId('chunk');
  const tokenCount = estimateTokens(content);

  // Insert into content_chunks
  db.prepare(`
    INSERT INTO content_chunks (
      id, source_type, source_id, project_id, chunk_index,
      content, location, token_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chunkId,
    'conversation_message',
    messageId,
    conv.project_id,
    0,
    content,
    JSON.stringify({
      conversation_id: message.conversation_id,
      round: message.round_number,
      speaker: message.speaker
    }),
    tokenCount,
    Date.now()
  );

  // Insert into FTS5 index
  db.prepare(`
    INSERT INTO retrieval_index (chunk_id, project_id, content, metadata)
    VALUES (?, ?, ?, ?)
  `).run(
    chunkId,
    conv.project_id,
    content,
    JSON.stringify({
      type: 'conversation',
      speaker: message.speaker,
      model: message.model_id,
      round: message.round_number
    })
  );

  return 1;
}

/**
 * Re-index all files in a project
 */
async function reindexProject(projectId) {
  const files = db.prepare('SELECT id FROM project_files WHERE project_id = ?')
    .all(projectId);

  let totalChunks = 0;
  for (const file of files) {
    const count = await indexFile(file.id);
    totalChunks += count;
  }

  return totalChunks;
}

module.exports = {
  indexFile,
  indexMessage,
  reindexProject
};
```

### 3. Search (server/indexing/search.js)

```javascript
const { db } = require('../db');

/**
 * Search across files and conversations
 */
function search(projectId, query, options = {}) {
  const {
    limit = 10,
    includeFiles = true,
    includeConversations = true,
    fileTypes = null  // e.g., ['.js', '.md'] (not yet implemented)
  } = options;

  // Determine which source types to include
  const allowedTypes = [];
  if (includeFiles) allowedTypes.push('file');
  if (includeConversations) allowedTypes.push('conversation');

  if (allowedTypes.length === 0) {
    return [];
  }

  // Build FTS5 query
  let sql = `
    SELECT
      chunk_id,
      project_id,
      bm25(retrieval_index) as rank,
      snippet(retrieval_index, 2, '<mark>', '</mark>', '...', 32) as snippet,
      metadata
    FROM retrieval_index
    WHERE retrieval_index MATCH ? AND project_id = ?
  `;

  const params = [query, projectId];

  // Filter by source type
  if (allowedTypes.length === 1) {
    sql += ` AND json_extract(metadata, '$.type') = ?`;
    params.push(allowedTypes[0]);
  } else {
    sql += ` AND json_extract(metadata, '$.type') IN (${allowedTypes.map(() => '?').join(',')})`;
    params.push(...allowedTypes);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  const results = db.prepare(sql).all(...params);

  // Enrich results with source info
  return results.map(result => {
    const metadata = JSON.parse(result.metadata);
    const chunk = db.prepare('SELECT * FROM content_chunks WHERE id = ?')
      .get(result.chunk_id);
    const location = JSON.parse(chunk.location);

    return {
      rank: result.rank,
      snippet: result.snippet,
      type: metadata.type,
      ...metadata,
      ...location
    };
  });
}

module.exports = { search };
```

### 4. Update File Storage (server/files/storage.js)

Add auto-indexing to `createFile` and `updateFile`:

```javascript
// At top of file
const { indexFile } = require('../indexing/indexer');

// In createFile function, after database insert:
async function createFile(projectId, filePath, content, mimeType = 'text/plain') {
  // ... existing code ...

  // Auto-index if text file
  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    try {
      await indexFile(fileId);
    } catch (err) {
      console.error('Indexing error:', err);
      // Don't fail file creation if indexing fails
    }
  }

  return getFile(fileId);
}

// In updateFile function, after database update:
async function updateFile(fileId, content) {
  // ... existing code ...

  // Re-index
  try {
    await indexFile(fileId);
  } catch (err) {
    console.error('Reindexing error:', err);
  }

  return getFile(fileId);
}
```

### 5. Update Conversation Writer (server/conversations/writer.js)

Add auto-indexing to `saveMessage`:

```javascript
// At top of file
const { indexMessage } = require('../indexing/indexer');

// In saveMessage function, after database insert:
async function saveMessage(conversationId, roundNumber, speaker, content, metadata = {}) {
  // ... existing code ...

  // Auto-index message
  try {
    await indexMessage(messageId);
  } catch (err) {
    console.error('Indexing error:', err);
  }

  return getMessage(messageId);
}
```

### 6. Search Route (add to server/server.js)

```javascript
const { search } = require('./indexing/search');

/**
 * POST /api/projects/:id/search
 * Search files and conversations
 */
app.post('/api/projects/:id/search', express.json(), (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { query, limit, includeFiles, includeConversations } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const results = search(projectId, query, {
      limit,
      includeFiles,
      includeConversations
    });

    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### 7. Integration Test (server/test-search.js)

```javascript
const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation, saveMessage } = require('./conversations/writer');
const { search } = require('./indexing/search');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Search ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Search Test', 'Testing search');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Create test files
    console.log('2. Creating test files...');
    await createFile(
      testProject.id,
      'auth.js',
      'function authenticate(user) {\n  // Check credentials\n  return validateToken(user.token);\n}',
      'text/javascript'
    );

    await createFile(
      testProject.id,
      'README.md',
      '# Authentication\n\nThis module handles user authentication using JWT tokens.',
      'text/markdown'
    );

    console.log('  ✓ Created test files\n');

    // Create conversation with messages
    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'Search Test Conv');
    await saveMessage(
      conv.id,
      1,
      'user',
      'How does authentication work?',
      {}
    );
    await saveMessage(
      conv.id,
      1,
      'agent:<model-id>',
      'Authentication works by validating JWT tokens.',
      { model: '<model-id>', provider: 'openai' }
    );
    console.log('  ✓ Created conversation with messages\n');

    // Search for "authentication"
    console.log('4. Searching for "authentication"...');
    const results1 = search(testProject.id, 'authentication');
    if (results1.length === 0) {
      throw new Error('No results found');
    }
    console.log(`  ✓ Found ${results1.length} results:`);
    results1.forEach(r => {
      console.log(`    - ${r.type}: ${r.file_path || `Round ${r.round}`}`);
    });
    console.log();

    // Search for "token"
    console.log('5. Searching for "token"...');
    const results2 = search(testProject.id, 'token');
    const hasFile = results2.some(r => r.type === 'file');
    const hasConv = results2.some(r => r.type === 'conversation');
    if (!hasFile || !hasConv) {
      throw new Error('Should find results in both files and conversations');
    }
    console.log('  ✓ Found results in both files and conversations\n');

    // Search files only
    console.log('6. Searching files only...');
    const results3 = search(testProject.id, 'authentication', {
      includeFiles: true,
      includeConversations: false
    });
    if (results3.some(r => r.type === 'conversation')) {
      throw new Error('Should not include conversations when includeConversations=false');
    }
    console.log('  ✓ Filtered to files only\n');

    // Test snippets
    console.log('7. Testing snippets...');
    if (!results1[0].snippet) {
      throw new Error('No snippet in results');
    }
    if (!results1[0].snippet.includes('<mark>')) {
      throw new Error('Snippet not highlighting matches');
    }
    console.log('  ✓ Snippets work\n');

    console.log('✅ All search tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      deleteProject(testProject.id);

      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
```

## Running

```bash
# Run search tests
node server/test-search.js
```

## Success Criteria

- [ ] Can index text files automatically
- [ ] Can index conversation messages automatically
- [ ] Can search and get results from files
- [ ] Can search and get results from conversations
- [ ] Results ranked by relevance (BM25)
- [ ] Snippets show matching context with highlights
- [ ] Can filter to files only or conversations only
- [ ] Test script passes

## Common Issues

**"No results found"**
→ Check files are being indexed (look at `content_chunks` table)

**"FTS5 error"**
→ Ensure FTS5 extension is enabled (should be by default in modern SQLite)

**"Snippets not highlighted"**
→ Check `<mark>` tags are in snippet output

## Next Steps

After this step completes:
- **Step 07:** Build system prompts that include search results
- **Step 08:** Add search UI

---

**Previous:** [05-tool-integration.md](05-tool-integration.md) | **Next:** [07-system-prompts.md](07-system-prompts.md)
