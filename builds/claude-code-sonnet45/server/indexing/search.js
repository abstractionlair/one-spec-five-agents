const { db } = require('../db');
const express = require('express');

const router = express.Router();

/**
 * Search across files and conversations
 */
function search(projectId, query, options = {}) {
  const {
    limit = 10,
    includeFiles = true,
    includeConversations = true
  } = options;

  // Build FTS5 query
  const ftsQuery = query.split(' ').map(term => `"${term}"`).join(' OR ');

  const sql = `
    SELECT
      chunk_id,
      project_id,
      content,
      metadata,
      bm25(retrieval_index) as rank,
      snippet(retrieval_index, 2, '<mark>', '</mark>', '...', 32) as snippet
    FROM retrieval_index
    WHERE retrieval_index MATCH ? AND project_id = ?
    ORDER BY rank
    LIMIT ?
  `;

  const results = db.prepare(sql).all(ftsQuery, projectId, limit);

  // Enrich results with chunk location
  return results.map(result => {
    const metadata = JSON.parse(result.metadata);
    const chunk = db.prepare('SELECT * FROM content_chunks WHERE id = ?')
      .get(result.chunk_id);

    const location = chunk ? JSON.parse(chunk.location) : {};

    return {
      rank: result.rank,
      snippet: result.snippet,
      type: metadata.type,
      ...location,
      ...metadata
    };
  }).filter(result => {
    if (!includeFiles && result.type === 'file') return false;
    if (!includeConversations && result.type === 'conversation') return false;
    return true;
  });
}

/**
 * POST /api/projects/:projectId/search
 * Search endpoint
 */
router.post('/projects/:projectId/search', express.json(), (req, res) => {
  try {
    const { projectId } = req.params;
    const { query, limit, includeFiles, includeConversations } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const results = search(projectId, query, {
      limit,
      includeFiles,
      includeConversations
    });

    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.search = search;
