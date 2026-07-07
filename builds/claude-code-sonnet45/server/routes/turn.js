const express = require('express');
const { getProject } = require('../db/projects');
const {
  createConversation,
  getConversation,
  saveMessage,
  listMessages
} = require('../conversations/writer');
const { readMessage } = require('../conversations/reader');
const { callOpenAI } = require('../adapters/openai');
const { callAnthropic } = require('../adapters/anthropic');
const { callGoogle } = require('../adapters/google');
const { buildSystemPrompt, buildMessagesWithSystem } = require('../prompts/builder');

const router = express.Router();

/**
 * Build message history for model context
 */
async function buildMessageHistory(messages, maxMessages = 10) {
  // Take last N messages
  const recentMessages = messages.slice(-maxMessages);

  // Load content for each message
  const messagesWithContent = await Promise.all(
    recentMessages.map(async (msg) => {
      const full = await readMessage(msg.id);
      return {
        role: msg.speaker === 'user' ? 'user' : 'assistant',
        content: full.content || ''
      };
    })
  );

  return messagesWithContent;
}

/**
 * POST /api/turn
 * Execute a conversation turn with one or more models
 */
router.post('/turn', express.json(), async (req, res) => {
  try {
    const {
      projectId,
      conversationId,
      userMessage,
      targetModels,
      roundNumber
    } = req.body;

    // Validate inputs
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    if (!userMessage) {
      return res.status(400).json({ error: 'userMessage is required' });
    }

    if (!targetModels || !Array.isArray(targetModels) || targetModels.length === 0) {
      return res.status(400).json({ error: 'targetModels is required and must be a non-empty array' });
    }

    // Check project exists
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
    } else {
      conversation = createConversation(projectId, 'New Conversation');
    }

    // Determine round number
    const round = roundNumber || conversation.round_count + 1;

    // Save user message
    const userMsg = await saveMessage(
      conversation.id,
      round,
      'user',
      userMessage,
      {}
    );

    // Load conversation history
    const allMessages = listMessages(conversation.id);

    // Build message history with content
    const messageHistory = await buildMessageHistory(allMessages);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(projectId, conversation.id);

    // Call each model in parallel
    const modelPromises = targetModels.map(async (modelSpec) => {
      const { provider, modelId } = modelSpec;

      try {
        let response;

        // Add system prompt to messages based on provider
        const { messages, system } = buildMessagesWithSystem(messageHistory, systemPrompt, provider);

        switch (provider) {
          case 'openai':
            response = await callOpenAI(messages, modelId, projectId);
            break;

          case 'anthropic':
            response = await callAnthropic(messages, modelId, projectId, system);
            break;

          case 'google':
            response = await callGoogle(messages, modelId, projectId);
            break;

          default:
            throw new Error(`Unknown provider: ${provider}`);
        }

        // Save agent message
        await saveMessage(
          conversation.id,
          round,
          `agent:${modelId}`,
          response.content,
          {
            model: modelId,
            provider,
            usage: response.usage,
            tool_calls: response.toolCalls
          }
        );

        return {
          provider,
          modelId,
          response: response.content,
          usage: response.usage,
          toolCalls: response.toolCalls
        };
      } catch (err) {
        console.error(`Error calling ${provider}/${modelId}:`, err);
        return {
          provider,
          modelId,
          error: err.message
        };
      }
    });

    const responses = await Promise.all(modelPromises);

    res.json({
      conversationId: conversation.id,
      roundNumber: round,
      responses
    });

  } catch (err) {
    console.error('Turn execution error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
