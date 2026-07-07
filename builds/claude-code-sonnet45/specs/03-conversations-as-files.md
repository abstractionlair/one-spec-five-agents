# Step 03: Conversations as Markdown Files

> **Note:** Examples in this guide use placeholder model names. When implementing, use the current production model identifiers from each provider.

**Goal:** Store conversation messages as markdown files with YAML frontmatter, track metadata in database.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 01 (Database schema)

## Overview

Conversations are stored as markdown files in `.conversations/` directories:
- Each conversation gets its own directory
- Messages stored as individual `.md` files with frontmatter
- Database tracks metadata for fast queries
- Files are the source of truth for content

## Directory Structure

```
projects/
  proj_abc123/
    files/
      .conversations/
        conv_xyz789/
          rounds/
            001-user.md
            001-agent-openai-model.md
            001-agent-anthropic-model.md
            002-user.md
            002-agent-openai-model.md
          metadata.json          # Optional: conversation-level metadata
```

## Message Format

```markdown
---
id: msg_abc123_def456
speaker: agent:openai-model
model: openai-flagship-model
provider: openai
round: 1
timestamp: 2025-01-22T10:30:00.000Z
usage:
  input_tokens: 1250
  output_tokens: 432
---

The authentication flow works by first checking the session cookie...
```

## File Structure

```
server/
  conversations/
    writer.js       # Save messages to markdown files
    reader.js       # Read and parse markdown files
    routes.js       # Express routes for conversation APIs
  utils/
    yaml.js         # Simple YAML parser/formatter
  test-conversations.js
```

## Implementation

### 1. YAML Utilities (server/utils/yaml.js)

```javascript
/**
 * Simple YAML formatter for frontmatter
 * Handles strings, numbers, booleans, and nested objects (one level)
 */
function formatYAML(obj, indent = 0) {
  const spaces = ' '.repeat(indent);
  const lines = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Nested object
      lines.push(`${spaces}${key}:`);
      for (const [k, v] of Object.entries(value)) {
        lines.push(`${spaces}  ${k}: ${v}`);
      }
    } else {
      // Primitive value
      lines.push(`${spaces}${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Simple YAML parser for frontmatter
 * Handles strings, numbers, booleans, and nested objects (one level)
 */
function parseYAML(yamlStr) {
  const lines = yamlStr.split('\n').filter(l => l.trim());
  const result = {};
  let currentKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for nested object (indented)
    if (line.startsWith('  ') && currentKey) {
      const match = trimmed.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (!result[currentKey]) result[currentKey] = {};
        result[currentKey][key] = parseValue(value);
      }
    } else {
      // Top-level key
      const match = trimmed.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        currentKey = key;
        if (value) {
          result[key] = parseValue(value);
        } else {
          result[key] = {};
        }
      }
    }
  }

  return result;
}

function parseValue(str) {
  // Number
  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }
  // Boolean
  if (str === 'true') return true;
  if (str === 'false') return false;
  // String
  return str;
}

module.exports = { formatYAML, parseYAML };
```

### 2. Conversation Writer (server/conversations/writer.js)

```javascript
const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');
const { newId } = require('../db/projects');
const { getProjectPath } = require('../files/storage');
const { formatYAML } = require('../utils/yaml');

/**
 * Create a new conversation
 */
function createConversation(projectId, title = null) {
  const id = newId('conv');
  const now = Date.now();

  db.prepare(`
    INSERT INTO conversations (id, project_id, title, round_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, 0, now, now);

  return getConversation(id);
}

/**
 * Get conversation by ID
 */
function getConversation(conversationId) {
  const stmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
  return stmt.get(conversationId);
}

/**
 * List conversations for a project
 */
function listConversations(projectId) {
  const stmt = db.prepare(`
    SELECT * FROM conversations
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `);
  return stmt.all(projectId);
}

/**
 * Save a message to markdown file
 */
async function saveMessage(conversationId, roundNumber, speaker, content, metadata = {}) {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error('Conversation not found');

  const messageId = newId('msg');
  const now = Date.now();
  const timestamp = new Date(now).toISOString();

  // Prepare frontmatter
  const frontmatter = {
    id: messageId,
    speaker,
    round: roundNumber,
    timestamp,
    ...metadata
  };

  // Format as markdown with frontmatter
  const markdown = `---\n${formatYAML(frontmatter)}\n---\n\n${content}`;

  // Determine file path
  const filename = `${String(roundNumber).padStart(3, '0')}-${speaker.replace(/:/g, '-')}.md`;
  const relativePath = `.conversations/${conversationId}/rounds/${filename}`;

  // Write to filesystem
  const projectPath = getProjectPath(conversation.project_id);
  const fullPath = path.join(projectPath, relativePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf-8');

  // Store metadata in database
  db.prepare(`
    INSERT INTO conversation_messages (
      id, conversation_id, round_number, speaker, file_path,
      model_id, provider, input_tokens, output_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    conversationId,
    roundNumber,
    speaker,
    relativePath,
    metadata.model || null,
    metadata.provider || null,
    metadata.usage?.input_tokens || null,
    metadata.usage?.output_tokens || null,
    now
  );

  // Update conversation round count and timestamp
  db.prepare(`
    UPDATE conversations
    SET round_count = ?, updated_at = ?
    WHERE id = ?
  `).run(roundNumber, now, conversationId);

  return getMessage(messageId);
}

/**
 * Get message metadata from database
 */
function getMessage(messageId) {
  const stmt = db.prepare('SELECT * FROM conversation_messages WHERE id = ?');
  return stmt.get(messageId);
}

/**
 * List messages in a conversation
 */
function listMessages(conversationId) {
  const stmt = db.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY round_number, created_at
  `);
  return stmt.all(conversationId);
}

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  saveMessage,
  getMessage,
  listMessages
};
```

### 3. Conversation Reader (server/conversations/reader.js)

```javascript
const fs = require('fs').promises;
const path = require('path');
const { getProjectPath } = require('../files/storage');
const { parseYAML } = require('../utils/yaml');
const { getMessage, listMessages } = require('./writer');

/**
 * Parse markdown file with YAML frontmatter
 */
function parseMarkdown(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);

  if (!match) {
    // No frontmatter
    return {
      frontmatter: {},
      content: markdown
    };
  }

  const [, yamlStr, content] = match;
  const frontmatter = parseYAML(yamlStr);

  return { frontmatter, content };
}

/**
 * Read message content from markdown file
 */
async function readMessage(messageId) {
  const message = getMessage(messageId);
  if (!message) throw new Error('Message not found');

  // Get project from conversation
  const { db } = require('../db');
  const conv = db.prepare('SELECT project_id FROM conversations WHERE id = ?')
    .get(message.conversation_id);

  const projectPath = getProjectPath(conv.project_id);
  const fullPath = path.join(projectPath, message.file_path);

  const markdown = await fs.readFile(fullPath, 'utf-8');
  const { frontmatter, content } = parseMarkdown(markdown);

  return {
    ...message,
    frontmatter,
    content
  };
}

/**
 * Get full conversation with all messages and content
 */
async function getConversationWithMessages(conversationId) {
  const { getConversation } = require('./writer');
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error('Conversation not found');

  const messages = listMessages(conversationId);

  // Load content for each message
  const messagesWithContent = await Promise.all(
    messages.map(async (msg) => {
      const full = await readMessage(msg.id);
      return full;
    })
  );

  return {
    ...conversation,
    messages: messagesWithContent
  };
}

module.exports = {
  parseMarkdown,
  readMessage,
  getConversationWithMessages
};
```

### 4. Conversation Routes (server/conversations/routes.js)

```javascript
const express = require('express');
const {
  createConversation,
  getConversation,
  listConversations,
  saveMessage,
  listMessages
} = require('./writer');
const { getConversationWithMessages } = require('./reader');

const router = express.Router();

/**
 * POST /api/conversations
 * Create a new conversation
 */
router.post('/conversations', express.json(), (req, res) => {
  try {
    const { projectId, title } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const conversation = createConversation(projectId, title);
    res.json({ conversation });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations/:id
 * Get conversation with all messages
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { includeContent } = req.query;

    if (includeContent === 'true') {
      // Load full content from files
      const conversation = await getConversationWithMessages(id);
      res.json({ conversation });
    } else {
      // Just metadata (faster)
      const conversation = getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const messages = listMessages(id);
      res.json({ conversation: { ...conversation, messages } });
    }
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations?projectId=xxx
 * List conversations for a project
 */
router.get('/conversations', (req, res) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const conversations = listConversations(projectId);
    res.json({ conversations });
  } catch (err) {
    console.error('List conversations error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/conversations/:id/messages
 * Add a message to conversation
 */
router.post('/conversations/:id/messages', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { roundNumber, speaker, content, metadata } = req.body;

    if (!roundNumber) {
      return res.status(400).json({ error: 'roundNumber is required' });
    }

    if (!speaker) {
      return res.status(400).json({ error: 'speaker is required' });
    }

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const message = await saveMessage(id, roundNumber, speaker, content, metadata || {});
    res.json({ message });
  } catch (err) {
    console.error('Save message error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

### 5. Integration Test (server/test-conversations.js)

```javascript
const { createProject, deleteProject } = require('./db/projects');
const {
  createConversation,
  getConversation,
  listConversations,
  saveMessage,
  listMessages
} = require('./conversations/writer');
const { readMessage, getConversationWithMessages } = require('./conversations/reader');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Conversations ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Conversation Test', 'Testing conversations');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Create conversation
    console.log('2. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test Conversation');
    console.log(`  ✓ Created conversation ${conv.id}\n`);

    // Save user message
    console.log('3. Saving user message...');
    const userMsg = await saveMessage(
      conv.id,
      1,
      'user',
      'Hello, please analyze the data.',
      {}
    );
    console.log(`  ✓ Saved user message ${userMsg.id}`);

    // Verify file exists
    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const msgPath = path.join(projectPath, userMsg.file_path);
    const exists = await fs.access(msgPath).then(() => true).catch(() => false);
    if (!exists) throw new Error('Message file not written');
    console.log(`  ✓ File created at ${userMsg.file_path}\n`);

    // Save agent message
    console.log('4. Saving agent message...');
    const agentMsg = await saveMessage(
      conv.id,
      1,
      'agent:gpt-4o',
      'I will analyze the data for you.',
      {
        model: 'gpt-4o',
        provider: 'openai',
        usage: {
          input_tokens: 150,
          output_tokens: 50
        }
      }
    );
    console.log(`  ✓ Saved agent message ${agentMsg.id}\n`);

    // Read message content
    console.log('5. Reading message content...');
    const fullMsg = await readMessage(userMsg.id);
    if (fullMsg.content !== 'Hello, please analyze the data.') {
      throw new Error('Message content mismatch');
    }
    console.log('  ✓ Can read message content');
    console.log('  ✓ Frontmatter parsed correctly\n');

    // List messages
    console.log('6. Listing messages...');
    const messages = listMessages(conv.id);
    if (messages.length !== 2) {
      throw new Error(`Expected 2 messages, got ${messages.length}`);
    }
    console.log(`  ✓ Listed ${messages.length} messages\n`);

    // Get full conversation
    console.log('7. Getting full conversation...');
    const fullConv = await getConversationWithMessages(conv.id);
    if (fullConv.messages.length !== 2) {
      throw new Error('Full conversation missing messages');
    }
    if (!fullConv.messages[0].content) {
      throw new Error('Messages missing content');
    }
    console.log('  ✓ Full conversation loaded with content\n');

    // Test multiple rounds
    console.log('8. Testing multiple rounds...');
    await saveMessage(conv.id, 2, 'user', 'What about trends?', {});
    await saveMessage(
      conv.id,
      2,
      'agent:gpt-4o',
      'The trend is upward.',
      { model: 'gpt-4o', provider: 'openai' }
    );

    const updated = getConversation(conv.id);
    if (updated.round_count !== 2) {
      throw new Error('Round count not updated');
    }
    console.log(`  ✓ Multiple rounds work, count: ${updated.round_count}\n`);

    // List conversations
    console.log('9. Listing conversations...');
    const convs = listConversations(testProject.id);
    if (convs.length !== 1) {
      throw new Error('Conversation not listed');
    }
    console.log(`  ✓ Listed ${convs.length} conversation(s)\n`);

    console.log('✅ All conversation tests passed!');

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
# Run integration tests
node server/test-conversations.js
```

## Success Criteria

- [ ] Can create conversation
- [ ] Can save user messages to .md files
- [ ] Can save agent messages to .md files
- [ ] Messages have correct YAML frontmatter
- [ ] Can read message content from files
- [ ] Can list messages in conversation
- [ ] Can get full conversation with content
- [ ] Multiple rounds work correctly
- [ ] Round count increments properly
- [ ] Frontmatter includes all metadata (usage, model, etc.)
- [ ] Test script passes

## Common Issues

**"YAML parsing failed"**
→ Check frontmatter format matches `key: value` pattern

**"File path includes colons"**
→ Speaker names like `agent:gpt-4o` need colons replaced in filenames

**"Messages out of order"**
→ Ensure database query sorts by `round_number, created_at`

## Next Steps

After this step completes:
- **Step 05:** Add tool calling to generate messages during /api/turn
- **Step 06:** Index conversation messages for search

---

**Previous:** [02-filesystem-storage.md](02-filesystem-storage.md) | **Next:** [04-docker-execution.md](04-docker-execution.md)
