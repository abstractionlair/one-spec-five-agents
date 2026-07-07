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