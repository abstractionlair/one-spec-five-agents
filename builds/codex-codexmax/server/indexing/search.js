const { db } = require('../db');

function search(projectId, query, options = {}) {
  const { limit = 10, includeFiles = true, includeConversations = true } = options;

  const allowedTypes = [];
  if (includeFiles) allowedTypes.push('file');
  if (includeConversations) allowedTypes.push('conversation');

  if (allowedTypes.length === 0) {
    return [];
  }

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

  if (allowedTypes.length === 1) {
    sql += ' AND json_extract(metadata, \'$.type\') = ?';
    params.push(allowedTypes[0]);
  } else {
    sql += ` AND json_extract(metadata, '$.type') IN (${allowedTypes.map(() => '?').join(',')})`;
    params.push(...allowedTypes);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  const results = db.prepare(sql).all(...params);

  return results.map((result) => {
    const metadata = JSON.parse(result.metadata);
    const chunk = db.prepare('SELECT * FROM content_chunks WHERE id = ?').get(result.chunk_id);
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
