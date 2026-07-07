const fs = require('fs').promises;
const path = require('path');
const { newId } = require('../db/projects');
const { getProjectPath } = require('../utils/paths');
const { formatYAML } = require('../utils/yaml');
const { indexMessage } = require('../indexing/indexer');
const {
  createConversationRecord,
  getConversation,
  listConversations,
  insertMessageRecord,
  updateConversationStats,
  getMessage,
  listMessages
} = require('./store');

/**
 * Create a new conversation
 */
function createConversation(projectId, title = null) {
  return createConversationRecord(projectId, title);
}

/**
 * Save a message to markdown file
 */
async function saveMessage(conversationId, roundNumber, speaker, content, metadata = {}) {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error('Conversation not found');

  const messageId = newId('msg');
  const now = Date.now();
  const timestamp = new Date(now).toISOString();

  // Prepare frontmatter
  const frontmatter = {
    id: messageId,
    speaker,
    round: roundNumber,
    timestamp,
    ...metadata
  };

  // Format as markdown with frontmatter
  const markdown = `---\n${formatYAML(frontmatter)}
---\n
${content}`;

  // Determine file path
  const filename = `${String(roundNumber).padStart(3, '0')}-${speaker.replace(/:/g, '-')}.md`;
  const relativePath = `.conversations/${conversationId}/rounds/${filename}`;

  // Write to filesystem
  const projectPath = getProjectPath(conversation.project_id);
  const fullPath = path.join(projectPath, relativePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf-8');

  // Store metadata in database
  insertMessageRecord({
    id: messageId,
    conversation_id: conversationId,
    round_number: roundNumber,
    speaker,
    file_path: relativePath,
    model_id: metadata.model || null,
    provider: metadata.provider || null,
    input_tokens: metadata.usage?.input_tokens || null,
    output_tokens: metadata.usage?.output_tokens || null,
    created_at: now
  });

  // Update conversation round count and timestamp
  updateConversationStats(conversationId, roundNumber, now);

  // Auto-index message
  try {
    await indexMessage(messageId);
  } catch (err) {
    console.error('Indexing error:', err);
  }

  return getMessage(messageId);
}

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  saveMessage,
  getMessage,
  listMessages
};