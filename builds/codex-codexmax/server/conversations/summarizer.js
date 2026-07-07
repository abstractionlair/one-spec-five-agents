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

async function summarizeRounds(conversationId, upToRound, options = {}) {
  const { provider = 'openai', modelId = 'gpt-4o-mini' } = options;

  const summary = await createSummary(conversationId, upToRound);
  if (!summary) {
    throw new Error('No messages to summarize');
  }

  const prompt = SUMMARIZATION_PROMPT + '\n\n' + summary.content;

  let result;
  if (provider === 'openai') {
    result = await sendOpenAI({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      tools: []
    });
  } else if (provider === 'anthropic') {
    result = await sendAnthropic({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a helpful assistant that creates concise summaries.',
      tools: []
    });
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  const settings = conv.settings ? JSON.parse(conv.settings) : {};
  settings.summary = {
    upToRound,
    content: result.text,
    createdAt: Date.now(),
    messageCount: summary.messageCount
  };

  db.prepare('UPDATE conversations SET settings = ? WHERE id = ?').run(JSON.stringify(settings), conversationId);

  return result.text;
}

function getSummary(conversationId) {
  const conv = db.prepare('SELECT settings FROM conversations WHERE id = ?').get(conversationId);
  if (!conv || !conv.settings) return null;

  const settings = JSON.parse(conv.settings);
  return settings.summary || null;
}

module.exports = {
  summarizeRounds,
  getSummary,
  SUMMARIZATION_PROMPT
};
