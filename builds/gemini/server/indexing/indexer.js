const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');
const { newId } = require('../db/projects');
const { getProjectPath } = require('../utils/paths');
const { chunkByLines, estimateTokens } = require('./chunker');
const { parseMarkdown } = require('../conversations/reader');

/**
 * Index a project file
 */
async function indexFile(fileId) {
  // Get file metadata
  const file = db.prepare('SELECT * FROM project_files WHERE id = ?').get(fileId);
  if (!file) throw new Error('File not found');

  // Read content
  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);
  const content = await fs.readFile(fullPath, 'utf-8');

  // Delete existing chunks and index entries for this file
  db.prepare(`
    DELETE FROM retrieval_index
    WHERE chunk_id IN (
      SELECT id FROM content_chunks
      WHERE source_type = ? AND source_id = ?
    )
  `).run('file', fileId);

  db.prepare(`
    DELETE FROM content_chunks
    WHERE source_type = ? AND source_id = ?
  `).run('file', fileId);

  // Chunk content
  const chunks = chunkByLines(content, 50);

  // Insert chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = newId('chunk');

    // Insert into content_chunks
    db.prepare(`
      INSERT INTO content_chunks (
        id, source_type, source_id, project_id, chunk_index,
        content, location, token_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunkId,
      'file',
      fileId,
      file.project_id,
      i,
      chunk.content,
      JSON.stringify({
        file_path: file.path,
        start_line: chunk.start_line,
        end_line: chunk.end_line
      }),
      chunk.token_count,
      Date.now()
    );

    // Insert into FTS5 index
    db.prepare(`
      INSERT INTO retrieval_index (chunk_id, project_id, content, metadata)
      VALUES (?, ?, ?, ?)
    `).run(
      chunkId,
      file.project_id,
      chunk.content,
      JSON.stringify({
        type: 'file',
        file_path: file.path,
        mime_type: file.mime_type
      })
    );
  }

  return chunks.length;
}

/**
 * Index a conversation message
 */
async function indexMessage(messageId) {
  // Get message metadata
  const message = db.prepare('SELECT * FROM conversation_messages WHERE id = ?')
    .get(messageId);
  if (!message) throw new Error('Message not found');

  // Get conversation to find project
  const conv = db.prepare('SELECT project_id FROM conversations WHERE id = ?')
    .get(message.conversation_id);

  // Read message file
  const projectPath = getProjectPath(conv.project_id);
  const fullPath = path.join(projectPath, message.file_path);
  const markdown = await fs.readFile(fullPath, 'utf-8');
  const { content } = parseMarkdown(markdown);

  // Delete existing chunk and index entry for this message
  db.prepare(`
    DELETE FROM retrieval_index
    WHERE chunk_id IN (
      SELECT id FROM content_chunks
      WHERE source_type = ? AND source_id = ?
    )
  `).run('conversation_message', messageId);

  db.prepare(`
    DELETE FROM content_chunks
    WHERE source_type = ? AND source_id = ?
  `).run('conversation_message', messageId);

  // Create single chunk for message
  const chunkId = newId('chunk');
  const tokenCount = estimateTokens(content);

  // Insert into content_chunks
  db.prepare(`
    INSERT INTO content_chunks (
      id, source_type, source_id, project_id, chunk_index,
      content, location, token_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chunkId,
    'conversation_message',
    messageId,
    conv.project_id,
    0,
    content,
    JSON.stringify({
      conversation_id: message.conversation_id,
      round: message.round_number,
      speaker: message.speaker
    }),
    tokenCount,
    Date.now()
  );

  // Insert into FTS5 index
  db.prepare(`
    INSERT INTO retrieval_index (chunk_id, project_id, content, metadata)
    VALUES (?, ?, ?, ?)
  `).run(
    chunkId,
    conv.project_id,
    content,
    JSON.stringify({
      type: 'conversation',
      speaker: message.speaker,
      model: message.model_id,
      round: message.round_number
    })
  );

  return 1;
}

/**
 * Re-index all files in a project
 */
async function reindexProject(projectId) {
  const files = db.prepare('SELECT id FROM project_files WHERE project_id = ?')
    .all(projectId);

  let totalChunks = 0;
  for (const file of files) {
    const count = await indexFile(file.id);
    totalChunks += count;
  }

  return totalChunks;
}

module.exports = {
  indexFile,
  indexMessage,
  reindexProject
};
