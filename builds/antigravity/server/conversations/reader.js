const fs = require('fs').promises;
const path = require('path');
const { getProjectPath } = require('../files/storage');
const { parseYAML } = require('../utils/yaml');
const { getMessage, listMessages } = require('./writer');

/**
 * Parse markdown file with YAML frontmatter
 */
function parseMarkdown(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);

    if (!match) {
        // No frontmatter
        return {
            frontmatter: {},
            content: markdown
        };
    }

    const [, yamlStr, content] = match;
    const frontmatter = parseYAML(yamlStr);

    return { frontmatter, content };
}

/**
 * Read message content from markdown file
 */
async function readMessage(messageId) {
    const message = getMessage(messageId);
    if (!message) throw new Error('Message not found');

    // Get project from conversation
    const { db } = require('../db');
    const conv = db.prepare('SELECT project_id FROM conversations WHERE id = ?')
        .get(message.conversation_id);

    const projectPath = getProjectPath(conv.project_id);
    const fullPath = path.join(projectPath, message.file_path);

    const markdown = await fs.readFile(fullPath, 'utf-8');
    const { frontmatter, content } = parseMarkdown(markdown);

    return {
        ...message,
        frontmatter,
        content
    };
}

/**
 * Get full conversation with all messages and content
 */
async function getConversationWithMessages(conversationId) {
    const { getConversation } = require('./writer');
    const conversation = getConversation(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const messages = listMessages(conversationId);

    // Load content for each message
    const messagesWithContent = await Promise.all(
        messages.map(async (msg) => {
            const full = await readMessage(msg.id);
            return full;
        })
    );

    return {
        ...conversation,
        messages: messagesWithContent
    };
}

module.exports = {
    parseMarkdown,
    readMessage,
    getConversationWithMessages
};
