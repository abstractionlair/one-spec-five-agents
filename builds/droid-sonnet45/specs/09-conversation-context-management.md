# Step 09: Conversation Context Management

**Goal:** Implement conversation summarization and pruning to handle conversations that exceed model context windows.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 05 (Tool integration), Step 07 (System prompts)

## Overview

As conversations grow, they will eventually exceed model context windows (typically 128k-200k tokens). This step implements strategies to:
- Detect when conversations are approaching context limits
- Summarize older conversation rounds
- Prune low-value messages
- Maintain conversation coherence

## Strategies

### 1. Rolling Window (Simple)
Keep only the N most recent messages, discarding older ones. Simple but loses context.

### 2. Summarization (Recommended)
Periodically summarize older rounds into condensed context. Preserves key information while reducing token count.

### 3. Hierarchical Summarization
Create multi-level summaries (per-round → multi-round → conversation). Allows flexible context retrieval.

## File Structure

```
server/
  conversations/
    context.js         # Context management
    summarizer.js      # Summarization logic
  test-context.js      # Integration tests
```

## Implementation

### 1. Context Manager (server/conversations/context.js)

```javascript
const { db } = require('../db');
const { getConversationWithMessages } = require('./reader');
const { estimateTokens } = require('../indexing/chunker');

const MAX_CONTEXT_TOKENS = 100000; // Conservative limit (most models support 128k+)
const SUMMARIZATION_THRESHOLD = 80000; // Trigger summarization at 80k tokens

/**
 * Estimate total tokens in conversation
 */
async function estimateConversationTokens(conversationId) {
  const conv = await getConversationWithMessages(conversationId);
  let totalTokens = 0;

  for (const msg of conv.messages) {
    totalTokens += estimateTokens(msg.content);
  }

  return totalTokens;
}

/**
 * Check if conversation needs summarization
 */
async function needsSummarization(conversationId) {
  const tokens = await estimateConversationTokens(conversationId);
  return tokens > SUMMARIZATION_THRESHOLD;
}

/**
 * Get messages for model context (with automatic pruning if needed)
 */
async function getContextMessages(conversationId, maxTokens = MAX_CONTEXT_TOKENS) {
  const conv = await getConversationWithMessages(conversationId);
  const messages = conv.messages;

  // Calculate tokens per message
  const messagesWithTokens = messages.map(msg => ({
    ...msg,
    tokens: estimateTokens(msg.content)
  }));

  // Try to fit as many recent messages as possible
  const selectedMessages = [];
  let currentTokens = 0;

  // Start from most recent and work backwards
  for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
    const msg = messagesWithTokens[i];
    if (currentTokens + msg.tokens <= maxTokens) {
      selectedMessages.unshift(msg);
      currentTokens += msg.tokens;
    } else {
      break;
    }
  }

  return {
    messages: selectedMessages,
    totalTokens: currentTokens,
    truncated: selectedMessages.length < messages.length,
    droppedMessages: messages.length - selectedMessages.length
  };
}

/**
 * Create summary of old messages
 */
async function createSummary(conversationId, upToRound) {
  const conv = await getConversationWithMessages(conversationId);
  
  // Get messages up to specified round
  const messagesToSummarize = conv.messages.filter(
    msg => msg.round_number <= upToRound
  );

  if (messagesToSummarize.length === 0) {
    return null;
  }

  // Format messages for summarization
  const formatted = messagesToSummarize.map(msg => {
    const speaker = msg.speaker === 'user' ? 'User' : msg.model_id || 'Assistant';
    return `[Round ${msg.round_number}] ${speaker}: ${msg.content}`;
  }).join('\n\n');

  return {
    upToRound,
    messageCount: messagesToSummarize.length,
    content: formatted
  };
}

module.exports = {
  estimateConversationTokens,
  needsSummarization,
  getContextMessages,
  createSummary,
  MAX_CONTEXT_TOKENS,
  SUMMARIZATION_THRESHOLD
};
```

### 2. Summarizer (server/conversations/summarizer.js)

```javascript
const { sendOpenAI } = require('../adapters/openai');
const { sendAnthropic } = require('../adapters/anthropic');
const { createSummary } = require('./context');
const { db } = require('../db');

const SUMMARIZATION_PROMPT = `You are tasked with summarizing a conversation to preserve key information while reducing length.

Create a concise summary that captures:
- Main topics and questions asked
- Key decisions and conclusions
- Important code or data mentioned
- Action items or next steps

Be specific but brief. Focus on information that would be useful in continuing the conversation.

Conversation to summarize:
`;

/**
 * Summarize conversation rounds using a model
 */
async function summarizeRounds(conversationId, upToRound, options = {}) {
  const {
    provider = 'openai',
    modelId = 'gpt-4o-mini'
  } = options;

  // Get formatted conversation content
  const summary = await createSummary(conversationId, upToRound);
  if (!summary) {
    throw new Error('No messages to summarize');
  }

  const prompt = SUMMARIZATION_PROMPT + '\n\n' + summary.content;

  // Call model to create summary
  let result;
  if (provider === 'openai') {
    result = await sendOpenAI({
      model: modelId,
      messages: [
        { role: 'user', content: prompt }
      ],
      tools: []
    });
  } else if (provider === 'anthropic') {
    result = await sendAnthropic({
      model: modelId,
      messages: [
        { role: 'user', content: prompt }
      ],
      system: 'You are a helpful assistant that creates concise summaries.',
      tools: []
    });
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Store summary in conversation metadata
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?')
    .get(conversationId);
  
  const settings = conv.settings ? JSON.parse(conv.settings) : {};
  settings.summary = {
    upToRound,
    content: result.text,
    createdAt: Date.now(),
    messageCount: summary.messageCount
  };

  db.prepare('UPDATE conversations SET settings = ? WHERE id = ?')
    .run(JSON.stringify(settings), conversationId);

  return result.text;
}

/**
 * Get conversation summary if it exists
 */
function getSummary(conversationId) {
  const conv = db.prepare('SELECT settings FROM conversations WHERE id = ?')
    .get(conversationId);
  
  if (!conv || !conv.settings) return null;

  const settings = JSON.parse(conv.settings);
  return settings.summary || null;
}

module.exports = {
  summarizeRounds,
  getSummary,
  SUMMARIZATION_PROMPT
};
```

### 3. Update Conversations Table Schema

Add a `settings` column to store summaries and other metadata:

```sql
-- In Step 01 schema.sql, update conversations table:
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings TEXT,              -- JSON: { summary, preferences, etc. }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### 4. Update Prompt Builder

Modify `server/prompts/builder.js` to use context-aware message retrieval:

```javascript
const { getContextMessages, getSummary } = require('../conversations/context');

/**
 * Build conversation messages with context management
 */
async function buildMessages({ conversationId, provider, modelId, roundNumber }) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) throw new Error('Conversation not found');

  const currentRound = roundNumber || (conv.round_count + 1);

  // Get context-managed messages (automatically handles truncation)
  const context = await getContextMessages(conversationId, 80000); // Leave room for system prompt

  // Check if we have a summary
  const summary = getSummary(conversationId);

  // Build system prompt
  let systemPrompt = buildSystemPrompt(provider, modelId, conv.project_id, currentRound);

  // Add summary to system prompt if available
  if (summary) {
    systemPrompt += `\n\n## Previous Conversation Summary\n\n`;
    systemPrompt += `(Summary of rounds 1-${summary.upToRound}, ${summary.messageCount} messages)\n\n`;
    systemPrompt += summary.content;
  }

  // Add truncation notice if needed
  if (context.truncated) {
    systemPrompt += `\n\n**Note:** This conversation has ${context.droppedMessages} older messages not shown due to context limits. `;
    systemPrompt += summary ? 'Key information is preserved in the summary above.' : 'Consider summarizing if important context is missing.';
  }

  // Format messages
  const chatMessages = context.messages.map((msg) => ({
    role: msg.speaker === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));

  // Provider-specific formatting
  if (provider === 'openai') {
    return {
      system: null,
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatMessages
      ]
    };
  }

  if (provider === 'anthropic') {
    return {
      system: systemPrompt,
      messages: chatMessages
    };
  }

  return {
    system: null,
    messages: chatMessages
  };
}
```

### 5. Add Summarization API Endpoint

Add to `server/server.js`:

```javascript
const { summarizeRounds } = require('./conversations/summarizer');
const { needsSummarization, estimateConversationTokens } = require('./conversations/context');

/**
 * POST /api/conversations/:id/summarize
 * Manually trigger summarization
 */
app.post('/api/conversations/:id/summarize', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { upToRound, provider, modelId } = req.body;

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Default to summarizing up to the current round - 1
    const targetRound = upToRound || (conv.round_count - 1);

    const summary = await summarizeRounds(id, targetRound, { provider, modelId });

    res.json({
      summary,
      upToRound: targetRound
    });
  } catch (err) {
    console.error('Summarization error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations/:id/stats
 * Get conversation statistics (token count, needs summarization, etc.)
 */
app.get('/api/conversations/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    const tokenCount = await estimateConversationTokens(id);
    const needsSummary = await needsSummarization(id);

    res.json({
      tokenCount,
      needsSummarization: needsSummary,
      threshold: SUMMARIZATION_THRESHOLD,
      maxTokens: MAX_CONTEXT_TOKENS
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### 6. Integration Test (server/test-context.js)

```javascript
const { createProject, deleteProject } = require('./db/projects');
const { createConversation, saveMessage } = require('./conversations/writer');
const {
  estimateConversationTokens,
  needsSummarization,
  getContextMessages
} = require('./conversations/context');
const { summarizeRounds, getSummary } = require('./conversations/summarizer');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Context Management ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Context Test', 'Testing context management');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Create conversation with multiple messages
    console.log('2. Creating conversation with messages...');
    const conv = createConversation(testProject.id, 'Context Test Conv');

    // Add several rounds of messages
    for (let round = 1; round <= 5; round++) {
      await saveMessage(
        conv.id,
        round,
        'user',
        `User message in round ${round}. `.repeat(20), // ~100 tokens
        {}
      );

      await saveMessage(
        conv.id,
        round,
        'agent:gpt-4o',
        `Assistant response in round ${round}. `.repeat(50), // ~250 tokens
        { model: 'gpt-4o', provider: 'openai' }
      );
    }
    console.log('  ✓ Created 5 rounds of messages\n');

    // Test token estimation
    console.log('3. Testing token estimation...');
    const tokens = await estimateConversationTokens(conv.id);
    if (tokens === 0) {
      throw new Error('Token estimation returned 0');
    }
    console.log(`  ✓ Estimated ${tokens} tokens\n`);

    // Test context messages retrieval
    console.log('4. Testing context message retrieval...');
    const context = await getContextMessages(conv.id, 1000); // Low limit to force truncation
    if (!context.truncated) {
      console.log('  ⚠️  Expected truncation with low token limit');
    } else {
      console.log(`  ✓ Truncated to ${context.messages.length} messages (dropped ${context.droppedMessages})\n`);
    }

    // Test summarization (skip if no API keys)
    if (process.env.OPENAI_API_KEY) {
      console.log('5. Testing summarization...');
      const summary = await summarizeRounds(conv.id, 3, {
        provider: 'openai',
        modelId: 'gpt-4o-mini'
      });

      if (!summary || summary.length === 0) {
        throw new Error('Summarization returned empty result');
      }
      console.log(`  ✓ Created summary (${summary.length} chars)\n`);

      // Test retrieving summary
      console.log('6. Testing summary retrieval...');
      const retrievedSummary = getSummary(conv.id);
      if (!retrievedSummary) {
        throw new Error('Could not retrieve saved summary');
      }
      if (retrievedSummary.upToRound !== 3) {
        throw new Error('Summary metadata incorrect');
      }
      console.log('  ✓ Retrieved summary with metadata\n');
    } else {
      console.log('5-6. Skipping summarization tests (no OPENAI_API_KEY)\n');
    }

    console.log('✅ All context management tests passed!');

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
# Run context management tests
node server/test-context.js
```

## Usage

### Automatic Context Management

The system automatically handles context limits when building prompts:

```javascript
// In /api/turn, context is automatically managed
const built = await buildMessages({
  conversationId,
  provider,
  modelId,
  roundNumber
});
// built.messages will only include messages that fit in context
```

### Manual Summarization

Users can trigger summarization via API:

```bash
curl -X POST http://localhost:3000/api/conversations/conv_123/summarize \
  -H 'Content-Type: application/json' \
  -d '{"upToRound": 10, "provider": "openai", "modelId": "gpt-4o-mini"}'
```

### Check Conversation Stats

```bash
curl http://localhost:3000/api/conversations/conv_123/stats
# Returns: { tokenCount: 45000, needsSummarization: false, ... }
```

## Success Criteria

- [ ] Can estimate conversation token count
- [ ] Can detect when summarization is needed
- [ ] Can retrieve context-limited messages
- [ ] Can create summaries using models
- [ ] Summaries stored in conversation metadata
- [ ] Prompt builder includes summaries
- [ ] Truncation notices added to system prompt
- [ ] API endpoints work correctly
- [ ] Test script passes

## Future Enhancements

1. **Semantic Chunking** - Keep messages with high semantic similarity to current query
2. **Importance Scoring** - Preserve high-value messages even if old
3. **Hierarchical Summaries** - Multi-level summaries for very long conversations
4. **Compression** - LLMLingua-style compression instead of summarization
5. **Vector Search** - Retrieve relevant past messages based on semantic similarity

## Next Steps

This completes the core implementation. Consider:
- **Production deployment** - Environment setup, monitoring
- **Performance optimization** - Caching, batch operations
- **Additional features** - Multi-user, real-time updates

---

**Previous:** [08-ui-and-testing.md](08-ui-and-testing.md) | **Roadmap:** [ROADMAP.md](../ROADMAP.md)
