# Step 07: System Prompts & Context

**Goal:** Build rich system prompts with project context, file listings, and bash tool instructions.

**Complexity:** Low (2-3 hours)

**Dependencies:** Step 05 (Tool integration), Step 06 (Search)

## Overview

System prompts provide models with:
- Project information and file structure
- Instructions for using bash tool
- Environment setup guidance (venv, npm, pixi)
- Conversation context

## File Structure

```
server/
  prompts/
    builder.js      # System prompt construction
    templates.js    # Prompt templates by provider
  test-prompts.js   # Test script
```

## Implementation

### 1. Prompt Templates (server/prompts/templates.js)

```javascript
/**
 * Base system prompt (provider-agnostic)
 */
function baseSystemPrompt({ projectName, modelId, fileList, roundNumber }) {
  return `You are ${modelId} participating in a multi-model conversation about the "${projectName}" project.

## Project Context

You have access to the project directory via the bash tool. The project currently contains ${fileList.length} file(s):

${fileList.slice(0, 20).map(f => `- ${f.path} (${formatBytes(f.size_bytes)})`).join('\n')}${fileList.length > 20 ? `\n... and ${fileList.length - 20} more files` : ''}

## Bash Tool Usage

You have access to a bash tool that executes commands in a sandboxed Docker container:

**Working Directory:** /project
**Persistent Storage:** Files you create persist between commands
**Network Access:** Enabled by default for installing packages and fetching data (can be disabled per project)

### Creating Python Environment

\`\`\`bash
# Create virtual environment
python3 -m venv .venv

# Activate and install packages
source .venv/bin/activate && pip install pandas numpy matplotlib

# Run scripts
source .venv/bin/activate && python analyze.py
\`\`\`

Or use pixi for conda-like environments:

\`\`\`bash
# Initialize pixi environment
pixi init

# Add packages (Python 3.x)
pixi add python=3.x pandas numpy matplotlib

# Run commands
pixi run python analyze.py
\`\`\`
Pixi is optional and more advanced. Prefer plain \`python3 -m venv\` unless you specifically need pixi-style workflows.

### Node.js / npm

\`\`\`bash
# Initialize package.json
npm init -y

# Install packages
npm install lodash axios

# Run scripts
node script.js
\`\`\`

### Best Practices

- Install packages into project directory (.venv, node_modules)
- Environments persist across tool calls
- Check if files exist before creating them
- Use relative paths
- Handle errors gracefully

## Conversation Context

This is round ${roundNumber} of the conversation.${roundNumber > 1 ? ' Previous messages are in the conversation history.' : ''}
`;
}

/**
 * OpenAI-specific system prompt
 */
function openaiSystemPrompt(context) {
  return baseSystemPrompt(context) + `

## Response Format

Provide clear, concise responses. Use the bash tool when you need to:
- Read or analyze files
- Create or modify code
- Install dependencies
- Run scripts or calculations

Be explicit about what you're doing and why.`;
}

/**
 * Anthropic-specific system prompt
 */
function anthropicSystemPrompt(context) {
  return baseSystemPrompt(context) + `

## Response Guidelines

Use the bash tool proactively when it would help answer the user's question. For example:
- If asked about data, read and analyze it
- If asked to create something, build it
- If code needs testing, run it

Explain your reasoning and show your work.`;
}

/**
 * Format bytes for display
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

module.exports = {
  openaiSystemPrompt,
  anthropicSystemPrompt,
  formatBytes
};
```

### 2. Prompt Builder (server/prompts/builder.js)

```javascript
const { db } = require('../db');
const { openaiSystemPrompt, anthropicSystemPrompt } = require('./templates');
const { getConversationWithMessages } = require('../conversations/reader');
const MAX_HISTORY_MESSAGES = 10;

/**
 * Build system prompt for a model
 */
function buildSystemPrompt(provider, modelId, projectId, roundNumber) {
  // Get project info
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Project not found');

  // Get file list
  const files = db.prepare(`
    SELECT path, size_bytes, mime_type
    FROM project_files
    WHERE project_id = ?
    ORDER BY path
  `).all(projectId);

  // Build context object
  const context = {
    projectName: project.name,
    modelId,
    fileList: files,
    roundNumber
  };

  // Choose template based on provider
  if (provider === 'openai') {
    return openaiSystemPrompt(context);
  } else if (provider === 'anthropic') {
    return anthropicSystemPrompt(context);
  } else {
    // Default for unknown providers
    return openaiSystemPrompt(context);
  }
}

/**
 * Build conversation messages with context, including recent history.
 * Returns an object:
 *   { system: string | null, messages: Array<{role, content}> }
 */
async function buildMessages({ conversationId, provider, modelId, roundNumber }) {
  // Load conversation with message contents
  const convWithMessages = await getConversationWithMessages(conversationId);
  const conv = convWithMessages;
  if (!conv) throw new Error('Conversation not found');

  // Use provided roundNumber if given, otherwise derive from conversation
  const currentRound = roundNumber || (conv.round_count + 1);

  // Take the last N messages (including the most recent user message)
  const allMessages = conv.messages || [];
  const history = allMessages.slice(-MAX_HISTORY_MESSAGES);

  const chatMessages = history.map((msg) => ({
    role: msg.speaker === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));

  // For OpenAI: system message goes in messages array
  if (provider === 'openai') {
    const systemPrompt = buildSystemPrompt(provider, modelId, conv.project_id, currentRound);

    return {
      system: null,
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatMessages
      ]
    };
  }

  // For Anthropic: system is separate parameter
  if (provider === 'anthropic') {
    const systemPrompt = buildSystemPrompt(provider, modelId, conv.project_id, currentRound);

    return {
      system: systemPrompt,
      messages: chatMessages
    };
  }

  // Default: just return the recent chat messages
  return {
    system: null,
    messages: chatMessages
  };
}

module.exports = {
  buildSystemPrompt,
  buildMessages
};
```

### 3. Update /api/turn (server/server.js)

Replace the hardcoded message building with the prompt builder:

```javascript
const { buildMessages } = require('./prompts/builder');

app.post('/api/turn', async (req, res) => {
  try {
    const {
      projectId,
      conversationId,
      userMessage,
      targetModels,
      roundNumber
    } = req.body;

    // ... validation ...

    // Save user message
    await saveMessage(
      conversationId,
      roundNumber,
      'user',
      userMessage,
      {}
    );

    // Query each model
    const modelPromises = targetModels.map(async ({ provider, modelId }) => {
      try {
        // Build messages with context
        const messagesOrObj = buildMessages(conversationId, userMessage, provider, modelId);

        // Tool call handler
        const onToolCall = async (toolName, args) => {
          return await executeTool(toolName, args, projectId, {
            timeout: 60000,
            network: 'bridge'
          });
        };

        let result;
        if (provider === 'openai') {
          // messagesOrObj is array with system message
          result = await sendOpenAI({
            model: modelId,
            messages: messagesOrObj,
            tools: [BASH_TOOL],
            onToolCall
          });
        } else if (provider === 'anthropic') {
          // messagesOrObj is { system, messages }
          result = await sendAnthropic({
            model: modelId,
            messages: messagesOrObj.messages,
            system: messagesOrObj.system,
            tools: [BASH_TOOL],
            onToolCall
          });
        } else {
          throw new Error(`Unknown provider: ${provider}`);
        }

        // Save response
        await saveMessage(
          conversationId,
          roundNumber,
          `agent:${modelId}`,
          result.text,
          {
            model: modelId,
            provider,
            usage: result.usage
          }
        );

        return {
          provider,
          modelId,
          response: result.text,
          usage: result.usage
        };

      } catch (err) {
        console.error(`Error querying ${provider}/${modelId}:`, err);
        return {
          provider,
          modelId,
          error: err.message
        };
      }
    });

    const responses = await Promise.all(modelPromises);

    res.json({
      responses,
      roundNumber
    });

  } catch (err) {
    console.error('Turn error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

### 4. Test Script (server/test-prompts.js)

```javascript
const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation } = require('./conversations/writer');
const { buildSystemPrompt, buildMessages } = require('./prompts/builder');

async function runTests() {
  console.log('=== Testing System Prompts ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Prompt Test', 'Testing system prompts');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Add some files
    console.log('2. Adding test files...');
    await createFile(testProject.id, 'test.py', 'print("hello")', 'text/x-python');
    await createFile(testProject.id, 'data.csv', 'a,b\n1,2', 'text/csv');
    console.log('  ✓ Added files\n');

    // Create conversation
    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test');
    console.log(`  ✓ Created conversation ${conv.id}\n`);

    // Build OpenAI system prompt (using a representative OpenAI chat model ID)
    console.log('4. Building OpenAI system prompt...');
    const openaiPrompt = buildSystemPrompt('openai', '<openai-model-id>', testProject.id, 1);

    if (!openaiPrompt.includes('Prompt Test')) {
      throw new Error('Prompt missing project name');
    }
    if (!openaiPrompt.includes('test.py')) {
      throw new Error('Prompt missing file listing');
    }
    if (!openaiPrompt.includes('bash')) {
      throw new Error('Prompt missing bash instructions');
    }
    if (!openaiPrompt.includes('venv')) {
      throw new Error('Prompt missing venv instructions');
    }
    console.log('  ✓ OpenAI prompt contains all required elements\n');

    // Build Anthropic system prompt (using a representative Anthropic chat model ID)
    console.log('5. Building Anthropic system prompt...');
    const anthropicPrompt = buildSystemPrompt('anthropic', '<anthropic-model-id>', testProject.id, 1);

    if (!anthropicPrompt.includes('Prompt Test')) {
      throw new Error('Prompt missing project name');
    }
    console.log('  ✓ Anthropic prompt contains required elements\n');

    // Build messages for OpenAI
    console.log('6. Building OpenAI messages...');
    // First, save an initial user message so there is history
    const { saveMessage } = require('./conversations/writer');
    await saveMessage(conv.id, 1, 'user', 'Hello', {});

    const openaiBuilt = await buildMessages({
      conversationId: conv.id,
      provider: 'openai',
      modelId: '<openai-model-id>',
      roundNumber: 1
    });

    if (!Array.isArray(openaiBuilt.messages)) {
      throw new Error('OpenAI messages should be array');
    }
    if (openaiBuilt.messages[0].role !== 'system') {
      throw new Error('First OpenAI message should be system');
    }
    if (!openaiBuilt.messages.some(m => m.role === 'user')) {
      throw new Error('OpenAI messages should include user history');
    }
    console.log('  ✓ OpenAI messages structured correctly with history\n');

    // Build messages for Anthropic
    console.log('7. Building Anthropic messages...');
    const anthropicBuilt = await buildMessages({
      conversationId: conv.id,
      provider: 'anthropic',
      modelId: '<anthropic-model-id>',
      roundNumber: 1
    });

    if (!anthropicBuilt.system) {
      throw new Error('Anthropic builder should return system property');
    }
    if (!Array.isArray(anthropicBuilt.messages)) {
      throw new Error('Anthropic messages should be array');
    }
    console.log('  ✓ Anthropic messages structured correctly with history\n');

    // Test file count display
    console.log('8. Testing file count display...');
    // Add many files
    for (let i = 0; i < 25; i++) {
      await createFile(testProject.id, `file${i}.txt`, `content ${i}`, 'text/plain');
    }

    const manyFilesPrompt = buildSystemPrompt('openai', '<openai-model-id>', testProject.id, 1);
    if (!manyFilesPrompt.includes('... and')) {
      throw new Error('Should truncate file list for many files');
    }
    console.log('  ✓ File list truncates for many files\n');

    console.log('✅ All system prompt tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      deleteProject(testProject.id);

      const path = require('path');
      const fs = require('fs').promises;
      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
```

## Running

```bash
# Run prompt tests
node server/test-prompts.js
```

## Success Criteria

- [ ] System prompt includes project name
- [ ] System prompt includes file listing
- [ ] System prompt includes bash tool instructions
- [ ] System prompt includes venv/npm/pixi examples
- [ ] OpenAI messages have system message in array
- [ ] Anthropic messages have separate system parameter
- [ ] File list truncates for many files (shows first 20)
- [ ] Test script passes

## Enhancements (Optional)

Consider adding in the future:
- **Search integration** - Include relevant search results in context
- **Conversation summary** - Summarize previous rounds
- **Cost tracking** - Warn if context getting large
- **Custom instructions** - Per-project customization

## Next Steps

After this step completes:
- **Step 08:** Create web UI for user interaction

---

**Previous:** [06-unified-search.md](06-unified-search.md) | **Next:** [08-ui-and-testing.md](08-ui-and-testing.md)
