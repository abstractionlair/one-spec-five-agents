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

// Mount file routes
const fileRoutes = require('./files/routes');
app.use('/api', fileRoutes);

// Mount project routes
const projectRoutes = require('./projects/routes');
app.use('/api', projectRoutes);

// Mount conversation routes
const conversationRoutes = require('./conversations/routes');
app.use('/api', conversationRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
