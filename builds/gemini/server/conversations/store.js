const { db } = require('../db');
const { newId } = require('../db/projects');

/**
 * Create a new conversation record
 */
function createConversationRecord(projectId, title = null) {
  const id = newId('conv');
  const now = Date.now();

  db.prepare(`
    INSERT INTO conversations (id, project_id, title, round_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, 0, now, now);

  return getConversation(id);
}

/**
 * Get conversation by ID
 */
function getConversation(conversationId) {
  const stmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
  return stmt.get(conversationId);
}

/**
 * List conversations for a project
 */
function listConversations(projectId) {
  const stmt = db.prepare(`
    SELECT * FROM conversations
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `);
  return stmt.all(projectId);
}

/**
 * Insert message record into database
 */
function insertMessageRecord(message) {
  const {
    id, conversation_id, round_number, speaker, file_path,
    model_id, provider, input_tokens, output_tokens, created_at
  } = message;

  db.prepare(`
    INSERT INTO conversation_messages (
      id, conversation_id, round_number, speaker, file_path,
      model_id, provider, input_tokens, output_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, conversation_id, round_number, speaker, file_path,
    model_id, provider, input_tokens, output_tokens, created_at
  );
}

/**
 * Update conversation round count and timestamp
 */
function updateConversationStats(conversationId, roundNumber, updatedAt) {
  db.prepare(`
    UPDATE conversations
    SET round_count = ?, updated_at = ?
    WHERE id = ?
  `).run(roundNumber, updatedAt, conversationId);
}

/**
 * Get message metadata from database
 */
function getMessage(messageId) {
  const stmt = db.prepare('SELECT * FROM conversation_messages WHERE id = ?');
  return stmt.get(messageId);
}

/**
 * List messages in a conversation
 */
function listMessages(conversationId) {
  const stmt = db.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY round_number, created_at
  `);
  return stmt.all(conversationId);
}

module.exports = {
  createConversationRecord,
  getConversation,
  listConversations,
  insertMessageRecord,
  updateConversationStats,
  getMessage,
  listMessages
};
