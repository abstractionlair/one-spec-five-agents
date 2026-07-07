const { db } = require('../db');
const { newId } = require('../db/projects');
const { chunkFile, chunkMessage } = require('./chunker');
const { readFileContent } = require('../files/storage');

/**
 * Index a file for search
 */
async function indexFile(fileId) {
  // Get file content
  const content = await readFileContent(fileId);
  const textContent = content.toString('utf-8');

  // Get file metadata
  const file = db.prepare('SELECT * FROM project_files WHERE id = ?').get(fileId);

  // Create chunks
  const chunks = chunkFile(file.path, textContent);

  // Delete existing chunks for this file
  db.prepare('DELETE FROM content_chunks WHERE source_type = ? AND source_id = ?')
    .run('file', fileId);

  // Insert new chunks
  const insertChunk = db.prepare(`
    INSERT INTO content_chunks (id, source_type, source_id, project_id, chunk_index, content, location, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFTS = db.prepare(`
    INSERT INTO retrieval_index (chunk_id, project_id, content, metadata)
    VALUES (?, ?, ?, ?)
  `);

  for (const chunk of chunks) {
    const chunkId = newId('chunk');
    const now = Date.now();

    insertChunk.run(
      chunkId,
      'file',
      fileId,
      file.project_id,
      chunk.index,
      chunk.content,
      JSON.stringify(chunk.location),
      chunk.tokenCount,
      now
    );

    insertFTS.run(
      chunkId,
      file.project_id,
      chunk.content,
      JSON.stringify({ type: 'file', path: file.path, mime_type: file.mime_type })
    );
  }

  return chunks.length;
}

/**
 * Index a conversation message for search
 */
async function indexMessage(messageId, messageContent) {
  // Get message metadata
  const message = db.prepare('SELECT * FROM conversation_messages WHERE id = ?').get(messageId);
  const conversation = db.prepare('SELECT project_id FROM conversations WHERE id = ?')
    .get(message.conversation_id);

  // Create chunks
  const chunks = chunkMessage(
    message.conversation_id,
    message.round_number,
    message.speaker,
    messageContent
  );

  // Delete existing chunks for this message
  db.prepare('DELETE FROM content_chunks WHERE source_type = ? AND source_id = ?')
    .run('conversation_message', messageId);

  // Insert new chunks
  const insertChunk = db.prepare(`
    INSERT INTO content_chunks (id, source_type, source_id, project_id, chunk_index, content, location, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFTS = db.prepare(`
    INSERT INTO retrieval_index (chunk_id, project_id, content, metadata)
    VALUES (?, ?, ?, ?)
  `);

  for (const chunk of chunks) {
    const chunkId = newId('chunk');
    const now = Date.now();

    insertChunk.run(
      chunkId,
      'conversation_message',
      messageId,
      conversation.project_id,
      chunk.index,
      chunk.content,
      JSON.stringify(chunk.location),
      chunk.tokenCount,
      now
    );

    insertFTS.run(
      chunkId,
      conversation.project_id,
      chunk.content,
      JSON.stringify({
        type: 'conversation',
        conversationId: message.conversation_id,
        round: message.round_number,
        speaker: message.speaker
      })
    );
  }

  return chunks.length;
}

module.exports = {
  indexFile,
  indexMessage
};
