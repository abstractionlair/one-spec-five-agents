const { db } = require('../db');
const { openaiSystemPrompt, anthropicSystemPrompt } = require('./templates');
const { getContextMessages } = require('../conversations/context');
const { getSummary } = require('../conversations/summarizer');

const MAX_CONTEXT_FOR_MESSAGES = 80000;

function buildSystemPrompt(provider, modelId, projectId, roundNumber) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Project not found');

  const files = db
    .prepare(
      `SELECT path, size_bytes, mime_type
       FROM project_files
       WHERE project_id = ?
       ORDER BY path`
    )
    .all(projectId);

  const context = {
    projectName: project.name,
    modelId,
    fileList: files,
    roundNumber
  };

  if (provider === 'openai') {
    return openaiSystemPrompt(context);
  }
  if (provider === 'anthropic') {
    return anthropicSystemPrompt(context);
  }
  return openaiSystemPrompt(context);
}

async function buildMessages({ conversationId, provider, modelId, roundNumber }) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) throw new Error('Conversation not found');

  const currentRound = roundNumber || conv.round_count + 1;

  const context = await getContextMessages(conversationId, MAX_CONTEXT_FOR_MESSAGES);
  const summary = getSummary(conversationId);

  let systemPrompt = buildSystemPrompt(provider, modelId, conv.project_id, currentRound);

  if (summary) {
    systemPrompt += `\n\n## Previous Conversation Summary\n\n`;
    systemPrompt += `(Summary of rounds 1-${summary.upToRound}, ${summary.messageCount} messages)\n\n`;
    systemPrompt += summary.content;
  }

  if (context.truncated) {
    systemPrompt += `\n\n**Note:** This conversation has ${context.droppedMessages} older messages not shown due to context limits. `;
    systemPrompt += summary
      ? 'Key information is preserved in the summary above.'
      : 'Consider summarizing if important context is missing.';
  }

  const chatMessages = context.messages.map((msg) => ({
    role: msg.speaker === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));

  if (provider === 'openai') {
    return {
      system: null,
      messages: [{ role: 'system', content: systemPrompt }, ...chatMessages]
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

module.exports = {
  buildSystemPrompt,
  buildMessages
};
