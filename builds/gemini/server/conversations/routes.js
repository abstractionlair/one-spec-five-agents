const express = require('express');
const {
  createConversation,
  getConversation,
  listConversations,
  saveMessage,
  listMessages
} = require('./writer');
const { getConversationWithMessages } = require('./reader');

const router = express.Router();

/**
 * POST /api/conversations
 * Create a new conversation
 */
router.post('/conversations', express.json(), (req, res) => {
  try {
    const { projectId, title } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const conversation = createConversation(projectId, title);
    res.json({ conversation });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations/:id
 * Get conversation with all messages
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { includeContent } = req.query;

    if (includeContent === 'true') {
      // Load full content from files
      const conversation = await getConversationWithMessages(id);
      res.json({ conversation });
    } else {
      // Just metadata (faster)
      const conversation = getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const messages = listMessages(id);
      res.json({ conversation: { ...conversation, messages } });
    }
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations?projectId=xxx
 * List conversations for a project
 */
router.get('/conversations', (req, res) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const conversations = listConversations(projectId);
    res.json({ conversations });
  } catch (err) {
    console.error('List conversations error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/conversations/:id/messages
 * Add a message to conversation
 */
router.post('/conversations/:id/messages', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { roundNumber, speaker, content, metadata } = req.body;

    if (!roundNumber) {
      return res.status(400).json({ error: 'roundNumber is required' });
    }

    if (!speaker) {
      return res.status(400).json({ error: 'speaker is required' });
    }

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const message = await saveMessage(id, roundNumber, speaker, content, metadata || {});
    res.json({ message });
  } catch (err) {
    console.error('Save message error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
