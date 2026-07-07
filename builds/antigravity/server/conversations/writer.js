const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');
const { newId } = require('../db/projects');
const { getProjectPath } = require('../files/storage');
const { formatYAML } = require('../utils/yaml');

/**
 * Create a new conversation
 */
function createConversation(projectId, title = null) {
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
    const markdown = `---\n${formatYAML(frontmatter)}\n---\n\n${content}`;

    // Determine file path
    const filename = `${String(roundNumber).padStart(3, '0')}-${speaker.replace(/:/g, '-')}.md`;
    const relativePath = `.conversations/${conversationId}/rounds/${filename}`;

    // Write to filesystem
    const projectPath = getProjectPath(conversation.project_id);
    const fullPath = path.join(projectPath, relativePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, markdown, 'utf-8');

    // Store metadata in database
    db.prepare(`
    INSERT INTO conversation_messages (
      id, conversation_id, round_number, speaker, file_path,
      model_id, provider, input_tokens, output_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
        messageId,
        conversationId,
        roundNumber,
        speaker,
        relativePath,
        metadata.model || null,
        metadata.provider || null,
        metadata.usage?.input_tokens || null,
        metadata.usage?.output_tokens || null,
        now
    );

    // Update conversation round count and timestamp
    db.prepare(`
    UPDATE conversations
    SET round_count = ?, updated_at = ?
    WHERE id = ?
  `).run(roundNumber, now, conversationId);

    return getMessage(messageId);
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
    createConversation,
    getConversation,
    listConversations,
    saveMessage,
    getMessage,
    listMessages
};
