require('dotenv').config();
const express = require('express');
const path = require('path');
const { dbPromise } = require('./db');
const { createConversation, saveMessage, getConversation } = require('./conversations/writer');
const { sendOpenAI } = require('./adapters/openai');
const { sendAnthropic } = require('./adapters/anthropic');
const { BASH_TOOL, executeTool } = require('./execution/tools');
const { buildMessages } = require('./prompts/builder');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

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
            network: 'bridge'  // Allow network by default
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
          usage: result.usage,
          warning: result.warning
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

// Mount project routes
const projectRoutes = require('./db/routes');
app.use('/api', projectRoutes);

// Mount file routes
const fileRoutes = require('./files/routes');
app.use('/api', fileRoutes);

// Mount conversation routes
const conversationRoutes = require('./conversations/routes');
app.use('/api', conversationRoutes);

const PORT = process.env.PORT || 3000;

// Wait for database initialization before starting server
dbPromise.then(() => {
  app.listen(PORT, () => {
    console.log(`\n✓ Multi-Model Chat server running on http://localhost:${PORT}`);
    console.log(`\nAPI Endpoints:`);
    console.log(`  POST /api/turn                    - Send message to models`);
    console.log(`  POST /api/projects/:id/files      - Upload file`);
    console.log(`  GET  /api/projects/:id/files      - List files`);
    console.log(`  POST /api/conversations           - Create conversation`);
    console.log(`  GET  /api/conversations/:id       - Get conversation\n`);

    // Check for API keys
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️  OPENAI_API_KEY not set - OpenAI models will not work');
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('⚠️  ANTHROPIC_API_KEY not set - Anthropic models will not work');
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;
