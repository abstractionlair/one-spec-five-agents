const { db } = require('../db');
const { getConversationWithMessages } = require('./reader');
const { estimateTokens } = require('../indexing/chunker');

const MAX_CONTEXT_TOKENS = 100000;
const SUMMARIZATION_THRESHOLD = 80000;

async function estimateConversationTokens(conversationId) {
  const conv = await getConversationWithMessages(conversationId);
  let totalTokens = 0;
  for (const msg of conv.messages) {
    totalTokens += estimateTokens(msg.content);
  }
  return totalTokens;
}

async function needsSummarization(conversationId) {
  const tokens = await estimateConversationTokens(conversationId);
  return tokens > SUMMARIZATION_THRESHOLD;
}

async function getContextMessages(conversationId, maxTokens = MAX_CONTEXT_TOKENS) {
  const conv = await getConversationWithMessages(conversationId);
  const messages = conv.messages;

  const messagesWithTokens = messages.map((msg) => ({
    ...msg,
    tokens: estimateTokens(msg.content)
  }));

  const selectedMessages = [];
  let currentTokens = 0;

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

async function createSummary(conversationId, upToRound) {
  const conv = await getConversationWithMessages(conversationId);
  const messagesToSummarize = conv.messages.filter((msg) => msg.round_number <= upToRound);

  if (messagesToSummarize.length === 0) {
    return null;
  }

  const formatted = messagesToSummarize
    .map((msg) => {
      const speaker = msg.speaker === 'user' ? 'User' : msg.model_id || 'Assistant';
      return `[Round ${msg.round_number}] ${speaker}: ${msg.content}`;
    })
    .join('\n\n');

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
