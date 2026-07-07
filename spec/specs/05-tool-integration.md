# Step 05: Tool Integration in /api/turn

**Goal:** Integrate bash execution as a tool in the main conversation endpoint, enabling models to execute code.

**Complexity:** High (4-6 hours)

**Dependencies:** Step 03 (Conversations), Step 04 (Docker execution)

## Overview

This step brings everything together:
- User sends message to `/api/turn` with target models
- Each model processes the message (can call `bash` tool)
- Tool calls execute in Docker
- Results returned to model for final response
- All messages saved to conversation

## API Flow

```
User: "Analyze data/sales.csv"

├─> GPT-4o
│   ├─ Calls bash: "head data/sales.csv"
│   ├─ Gets output
│   ├─ Calls bash: "python analyze.py"
│   ├─ Gets output
│   └─ Returns: "Sales are up 15%..."
│
└─> Claude Sonnet
    ├─ Calls bash: "wc -l data/sales.csv"
    ├─ Gets output
    └─ Returns: "The file has 1000 rows..."
```

## File Structure

```
server/
  server.js           # Main Express app, /api/turn route
  adapters/
    openai.js         # OpenAI API with tool support
    anthropic.js      # Anthropic API with tool support
    google.js         # Google API with tool support
    shared.js         # Shared tool definitions
  execution/
    tools.js          # Tool executor (bash)
  test-turn.js        # Integration test
```

## Implementation

### 1. Tool Definitions (server/execution/tools.js)

```javascript
const { executeBash } = require('./docker');

/**
 * Tool definition for bash execution
 */
const BASH_TOOL = {
  name: 'bash',
  description: 'Execute bash commands in the project directory. Use this to create files, run scripts, install packages, analyze data, etc. Commands run in a sandboxed Docker container with access to the project directory.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute. Can be multiline. Working directory is /project.'
      }
    },
    required: ['command']
  }
};

/**
 * Execute a tool call
 */
async function executeTool(toolName, args, projectId, options = {}) {
  if (toolName === 'bash') {
    const { command } = args;
    if (!command) {
      throw new Error('bash tool requires command argument');
    }

    const result = await executeBash(command, projectId, options);

    // Format result for model
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      success: result.success
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = {
  BASH_TOOL,
  executeTool
};
```
> Note: `executeTool` should respect per-project settings (e.g., network access) when you wire it into the executor. For now, you can pass `network: 'bridge'` by default and later derive it from `projects.settings.allow_network`.

### 2. OpenAI Adapter (server/adapters/openai.js)

```javascript
const OpenAI = require('openai');
const { BASH_TOOL } = require('../execution/tools');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Convert bash tool to OpenAI format
 */
function formatToolForOpenAI(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

/**
 * Send messages to OpenAI with tool support
 */
async function sendOpenAI({ model, messages, tools = [], onToolCall }) {
  const openaiMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  const openaiTools = tools.map(formatToolForOpenAI);

  let completion = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    tools: openaiTools.length > 0 ? openaiTools : undefined,
    tool_choice: openaiTools.length > 0 ? 'auto' : undefined
  });

  let usage = {
    input_tokens: completion.usage.prompt_tokens,
    output_tokens: completion.usage.completion_tokens
  };

  // Handle tool calls (with loop limit to prevent infinite loops)
  let toolCallIterations = 0;
  const MAX_TOOL_ITERATIONS = 10;

  while (completion.choices[0].finish_reason === 'tool_calls' && toolCallIterations < MAX_TOOL_ITERATIONS) {
    toolCallIterations++;
    const toolCalls = completion.choices[0].message.tool_calls;

    // Execute tools
    const toolResults = [];
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await onToolCall(toolCall.function.name, args);

      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify(result)
      });
    }

    // Add assistant message with tool calls
    openaiMessages.push(completion.choices[0].message);

    // Add tool results
    openaiMessages.push(...toolResults);

    // Continue conversation
    completion = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto'
    });

    // Accumulate usage
    usage.input_tokens += completion.usage.prompt_tokens;
    usage.output_tokens += completion.usage.completion_tokens;
  }

  // Check if we hit the iteration limit
  if (toolCallIterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`Tool call loop limit reached (${MAX_TOOL_ITERATIONS} iterations)`);
    // Return partial result with warning
    const partialText = completion.choices[0].message.content || 
      '[Tool call limit reached - conversation stopped to prevent infinite loop]';
    return {
      text: partialText,
      usage,
      warning: 'Maximum tool call iterations reached'
    };
  }

  return {
    text: completion.choices[0].message.content,
    usage
  };
}

module.exports = { sendOpenAI };
```

### 3. Anthropic Adapter (server/adapters/anthropic.js)

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const { BASH_TOOL } = require('../execution/tools');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Convert bash tool to Anthropic format
 */
function formatToolForAnthropic(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  };
}

/**
 * Send messages to Anthropic with tool support
 */
async function sendAnthropic({ model, messages, system, tools = [], onToolCall }) {
  const anthropicMessages = messages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

  const anthropicTools = tools.map(formatToolForAnthropic);

  let response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: anthropicMessages,
    tools: anthropicTools.length > 0 ? anthropicTools : undefined
  });

  let usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens
  };

  // Handle tool use (with loop limit to prevent infinite loops)
  let toolCallIterations = 0;
  const MAX_TOOL_ITERATIONS = 10;

  while (response.stop_reason === 'tool_use' && toolCallIterations < MAX_TOOL_ITERATIONS) {
    toolCallIterations++;
    // Find tool use blocks
    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

    // Execute tools
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const result = await onToolCall(toolUse.name, toolUse.input);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result)
      });
    }

    // Add assistant message
    anthropicMessages.push({
      role: 'assistant',
      content: response.content
    });

    // Add tool results
    anthropicMessages.push({
      role: 'user',
      content: toolResults
    });

    // Continue conversation
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: anthropicMessages,
      tools: anthropicTools
    });

    // Accumulate usage
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
  }

  // Check if we hit the iteration limit
  if (toolCallIterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`Tool call loop limit reached (${MAX_TOOL_ITERATIONS} iterations)`);
    // Extract any text we have so far
    const textBlocks = response.content.filter(block => block.type === 'text');
    const partialText = textBlocks.length > 0 
      ? textBlocks.map(block => block.text).join('\n')
      : '[Tool call limit reached - conversation stopped to prevent infinite loop]';
    return {
      text: partialText,
      usage,
      warning: 'Maximum tool call iterations reached'
    };
  }

  // Extract text from content blocks
  const textBlocks = response.content.filter(block => block.type === 'text');
  const text = textBlocks.map(block => block.text).join('\n');

  return {
    text,
    usage
  };
}

module.exports = { sendAnthropic };
```

> Adapter note: Treat these adapter implementations as examples of the desired behavior and response shape (`{ text, usage }`), not as a frozen SDK contract. SDKs change over time; keep all provider-specific quirks inside these adapter modules so the rest of the system can stay stable.

### 4. Main Server (server/server.js)

```javascript
const express = require('express');
const { createConversation, saveMessage } = require('./conversations/writer');
const { sendOpenAI } = require('./adapters/openai');
const { sendAnthropic } = require('./adapters/anthropic');
const { BASH_TOOL, executeTool } = require('./execution/tools');
const { buildMessages } = require('./prompts/builder');

const app = express();

app.use(express.json());
app.use(express.static('web'));

/**
 * POST /api/turn
 * Send message to multiple models, get responses
 */
app.post('/api/turn', async (req, res) => {
  try {
    const {
      projectId,
      conversationId: providedConversationId,
      userMessage,
      targetModels,  // [{ provider: 'openai', modelId: 'gpt-4o' }, ...]
      roundNumber    // Optional; auto-incremented if omitted
    } = req.body;

    if (!projectId || !userMessage || !targetModels) {
      return res.status(400).json({
        error: 'Missing required fields: projectId, userMessage, targetModels'
      });
    }

    // Ensure conversation exists (create if needed)
    let conversationId = providedConversationId;
    if (!conversationId) {
      const conv = createConversation(projectId, null);
      conversationId = conv.id;
    }

    // Determine round number (auto-increment if not provided)
    const { getConversation } = require('./conversations/writer');
    const convMeta = getConversation(conversationId);
    const effectiveRoundNumber = roundNumber || (convMeta.round_count + 1);

    // Save user message for this round
    await saveMessage(conversationId, effectiveRoundNumber, 'user', userMessage, {});

    // Query each model in parallel
    const modelPromises = targetModels.map(async ({ provider, modelId }) => {
      try {
        // Build conversation history + system prompt for this model
        const built = await buildMessages({
          conversationId,
          provider,
          modelId,
          roundNumber: effectiveRoundNumber
        });

        // Tool call handler
        const onToolCall = async (toolName, args) => {
          return await executeTool(toolName, args, projectId, {
            timeout: 60000,
            network: 'bridge'  // Allow network by default (can tie to project settings)
          });
        };

        let result;
        if (provider === 'openai') {
          result = await sendOpenAI({
            model: modelId,
            messages: built.messages,
            tools: [BASH_TOOL],
            onToolCall
          });
        } else if (provider === 'anthropic') {
          result = await sendAnthropic({
            model: modelId,
            messages: built.messages,
            system: built.system,
            tools: [BASH_TOOL],
            onToolCall
          });
        } else {
          throw new Error(`Unknown provider: ${provider}`);
        }

        // Save agent response
        await saveMessage(
          conversationId,
          effectiveRoundNumber,
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
      conversationId,
      roundNumber: effectiveRoundNumber,
      responses
    });

  } catch (err) {
    console.error('Turn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mount file routes
const fileRoutes = require('./files/routes');
app.use('/api', fileRoutes);

// Mount conversation routes
const conversationRoutes = require('./conversations/routes');
app.use('/api', conversationRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
```

### 5. Integration Test (server/test-turn.js)

```javascript
const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation } = require('./conversations/writer');
const { getConversationWithMessages } = require('./conversations/reader');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Assumes server is running
const API_URL = 'http://localhost:3000';

async function runTests() {
  console.log('=== Testing /api/turn ===\n');
  console.log('⚠️  Make sure server is running (npm start)\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Turn Test', 'Testing /api/turn');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Create test data file
    console.log('2. Creating test data...');
    await createFile(
      testProject.id,
      'data.csv',
      'name,value\nAlice,100\nBob,200\nCharlie,150',
      'text/csv'
    );
    console.log('  ✓ Created data.csv\n');

    // Create conversation
    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test Turn');
    console.log(`  ✓ Created conversation ${conv.id}\n`);

    // Test simple query (explicit conversationId and roundNumber)
    console.log('4. Testing simple query...');
    const response1 = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'What is 2+2?',
      targetModels: [
        { provider: 'openai', modelId: 'gpt-4o-mini' }
      ],
      roundNumber: 1
    });

    if (!response1.data.responses[0].response) {
      throw new Error('No response from model');
    }
    console.log('  ✓ Got response from gpt-4o-mini');
    console.log(`  Response: ${response1.data.responses[0].response.slice(0, 100)}...\n`);

    // Test tool calling with auto-incremented roundNumber
    console.log('5. Testing tool calling (auto round)...');
    const response2 = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'Count the lines in data.csv using bash',
      targetModels: [
        { provider: 'openai', modelId: 'gpt-4o-mini' }
      ]
      // roundNumber omitted on purpose
    });

    const toolResponse = response2.data.responses[0];
    if (!toolResponse.response) {
      throw new Error('No response from model');
    }
    console.log('  ✓ Model called bash tool');
    console.log(`  Response: ${toolResponse.response}\n`);

    // Verify conversation was saved
    console.log('6. Verifying conversation saved...');
    const fullConv = await getConversationWithMessages(conv.id);
    if (fullConv.messages.length < 4) {  // 2 user + 2 agent
      throw new Error('Not all messages saved');
    }
    console.log(`  ✓ Saved ${fullConv.messages.length} messages\n`);

    // Test multiple models, letting server handle round numbering
    console.log('7. Testing multiple models...');
    const response3 = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'Create a file called output.txt with the content "Hello"',
      targetModels: [
        { provider: 'openai', modelId: 'gpt-4o-mini' },
        { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }
      ]
      // roundNumber omitted
    });

    if (response3.data.responses.length !== 2) {
      throw new Error('Expected 2 responses');
    }
    console.log('  ✓ Got responses from both models');

    // Verify file was created
    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const outputPath = path.join(projectPath, 'output.txt');
    const outputExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!outputExists) {
      throw new Error('Model did not create output.txt');
    }
    console.log('  ✓ Model created file via bash\n');

    // Test usage tracking
    console.log('8. Testing usage tracking...');
    const lastMessage = fullConv.messages[fullConv.messages.length - 1];
    if (!lastMessage.input_tokens || !lastMessage.output_tokens) {
      throw new Error('Usage not tracked');
    }
    console.log(`  ✓ Usage tracked: ${lastMessage.input_tokens} in, ${lastMessage.output_tokens} out\n`);

    console.log('✅ All /api/turn tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err.response?.data || err.message);
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
# Terminal 1: Start server
npm start

# Terminal 2: Run tests
node server/test-turn.js
```

## Success Criteria

- [ ] `/api/turn` endpoint works
- [ ] Can send message to single model
- [ ] Model can call bash tool
- [ ] Tool results returned to model
- [ ] Model generates final response
- [ ] User and agent messages saved to conversation
- [ ] Works with OpenAI models
- [ ] Works with Anthropic models
- [ ] Can query multiple models in parallel
- [ ] Usage tracking works (token counts)
- [ ] Multi-turn tool calling works
- [ ] Test script passes

## Common Issues

**"API key not found"**
→ Set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env`

**"Tool calls not working"**
→ Check tool definition format matches provider requirements

**"Conversation not saving"**
→ Ensure `conversationId` is valid and passed to endpoint

**"Docker timeout"**
→ Increase timeout for complex operations

## Next Steps

After this step completes:
- **Step 06:** Add search indexing for files and conversations
- **Step 07:** Build system prompts with project context
- **Step 08:** Create web UI

---

**Previous:** [04-docker-execution.md](04-docker-execution.md) | **Next:** [06-unified-search.md](06-unified-search.md)
