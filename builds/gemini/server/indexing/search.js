const { db } = require('../db');

/**
 * Search across files and conversations
 */
function search(projectId, query, options = {}) {
  const {
    limit = 10,
    includeFiles = true,
    includeConversations = true,
    fileTypes = null  // e.g., ['.js', '.md'] (not yet implemented)
  } = options;

  // Determine which source types to include
  const allowedTypes = [];
  if (includeFiles) allowedTypes.push('file');
  if (includeConversations) allowedTypes.push('conversation');

  if (allowedTypes.length === 0) {
    return [];
  }

  // Build FTS5 query
  let sql = `
    SELECT
      chunk_id,
      project_id,
      bm25(retrieval_index) as rank,
      snippet(retrieval_index, 2, '<mark>', '</mark>', '...', 32) as snippet,
      metadata
    FROM retrieval_index
    WHERE retrieval_index MATCH ? AND project_id = ?
  `;

  const params = [query, projectId];

  // Filter by source type
  if (allowedTypes.length === 1) {
    sql += ` AND json_extract(metadata, '$.type') = ?`;
    params.push(allowedTypes[0]);
  } else {
    sql += ` AND json_extract(metadata, '$.type') IN (${allowedTypes.map(() => '?').join(',')})`;
    params.push(...allowedTypes);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  const results = db.prepare(sql).all(...params);

  // Enrich results with source info
  return results.map(result => {
    const metadata = JSON.parse(result.metadata);
    const chunk = db.prepare('SELECT * FROM content_chunks WHERE id = ?')
      .get(result.chunk_id);
    const location = JSON.parse(chunk.location);

    return {
      rank: result.rank,
      snippet: result.snippet,
      type: metadata.type,
      ...metadata,
      ...location
    };
  });
}

module.exports = { search };
