require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { runMigrations } = require('./db/migrations');
const {
  listProjects,
  createProject,
  getProject,
  deleteProject
} = require('./db/projects');
const { createConversation, saveMessage, getConversation } = require('./conversations/writer');
const fileRoutes = require('./files/routes');
const conversationRoutes = require('./conversations/routes');
const { buildMessages } = require('./prompts/builder');
const { sendOpenAI } = require('./adapters/openai');
const { sendAnthropic } = require('./adapters/anthropic');
const { BASH_TOOL, executeTool } = require('./execution/tools');
const { search } = require('./indexing/search');
const {
  summarizeRounds
} = require('./conversations/summarizer');
const {
  estimateConversationTokens,
  needsSummarization,
  SUMMARIZATION_THRESHOLD,
  MAX_CONTEXT_TOKENS
} = require('./conversations/context');

runMigrations();

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'web')));

/**
 * Projects
 */
app.get('/api/projects', (req, res) => {
  try {
    const projects = listProjects();
    res.json({ projects });
  } catch (err) {
    console.error('List projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const { name, description, settings } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const project = createProject(name, description || '', settings || {});
    res.json({ project });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project });
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = getProject(id);
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }
    deleteProject(id);
    const projectDir = path.join(__dirname, '..', 'projects', id);
    await fs.rm(projectDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Turn endpoint
 */
app.post('/api/turn', async (req, res) => {
  try {
    const { projectId, conversationId: providedConversationId, userMessage, targetModels, roundNumber } = req.body;

    if (!projectId || !userMessage || !targetModels) {
      return res.status(400).json({
        error: 'Missing required fields: projectId, userMessage, targetModels'
      });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let conversationId = providedConversationId;
  if (!conversationId) {
    const conv = createConversation(projectId, null);
    conversationId = conv.id;
  }

  const convMeta = getConversation(conversationId);
  if (!convMeta) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  const effectiveRoundNumber = roundNumber || convMeta.round_count + 1;

    await saveMessage(conversationId, effectiveRoundNumber, 'user', userMessage, {});

    const networkMode = project.settings && project.settings.allow_network === false ? 'none' : 'bridge';

    const modelPromises = targetModels.map(async ({ provider, modelId }) => {
      try {
        const built = await buildMessages({
          conversationId,
          provider,
          modelId,
          roundNumber: effectiveRoundNumber
        });

        const onToolCall = async (toolName, args) => {
          return executeTool(toolName, args, projectId, {
            timeout: 60000,
            network: networkMode
          });
        };

        let result;
        if (provider === 'openai') {
          result = await sendOpenAI({
            model: modelId,
            messages: built.messages,
            tools: [BASH_TOOL],
            onToolCall
          });
        } else if (provider === 'anthropic') {
          result = await sendAnthropic({
            model: modelId,
            messages: built.messages,
            system: built.system,
            tools: [BASH_TOOL],
            onToolCall
          });
        } else {
          throw new Error(`Unknown provider: ${provider}`);
        }

        await saveMessage(conversationId, effectiveRoundNumber, `agent:${modelId}`, result.text, {
          model: modelId,
          provider,
          usage: result.usage
        });

        return {
          provider,
          modelId,
          response: result.text,
          usage: result.usage
        };
      } catch (err) {
        console.error(`Error querying ${provider}/${modelId}:`, err);
        return {
          provider,
          modelId,
          error: err.message
        };
      }
    });

    const responses = await Promise.all(modelPromises);

    res.json({
      conversationId,
      roundNumber: effectiveRoundNumber,
      responses
    });
  } catch (err) {
    console.error('Turn error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Search
 */
app.post('/api/projects/:id/search', (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { query, limit, includeFiles, includeConversations } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const results = search(projectId, query, { limit, includeFiles, includeConversations });
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Summarization endpoints
 */
app.post('/api/conversations/:id/summarize', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { upToRound, provider, modelId } = req.body;

    const conv = getConversation(id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const targetRound = upToRound || conv.round_count - 1;
    const summary = await summarizeRounds(id, targetRound, { provider, modelId });

    res.json({ summary, upToRound: targetRound });
  } catch (err) {
    console.error('Summarization error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversations/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const tokenCount = await estimateConversationTokens(id);
    const needsSummary = await needsSummarization(id);

    res.json({
      tokenCount,
      needsSummarization: needsSummary,
      threshold: SUMMARIZATION_THRESHOLD,
      maxTokens: MAX_CONTEXT_TOKENS
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mount other routes
app.use('/api', fileRoutes);
app.use('/api', conversationRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
