/**
 * Split content into searchable chunks
 */

const CHUNK_SIZE = 500; // ~500 tokens per chunk
const LINES_PER_CHUNK = 50;

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk text content by lines
 */
function chunkByLines(content, maxLines = LINES_PER_CHUNK) {
  const lines = content.split('\n');
  const chunks = [];

  for (let i = 0; i < lines.length; i += maxLines) {
    const chunkLines = lines.slice(i, i + maxLines);
    const chunkText = chunkLines.join('\n');

    chunks.push({
      content: chunkText,
      startLine: i + 1,
      endLine: Math.min(i + maxLines, lines.length),
      tokenCount: estimateTokens(chunkText)
    });
  }

  return chunks;
}

/**
 * Chunk file content
 */
function chunkFile(filePath, content) {
  const chunks = chunkByLines(content);

  return chunks.map((chunk, index) => ({
    ...chunk,
    location: {
      type: 'file',
      path: filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine
    },
    index
  }));
}

/**
 * Chunk conversation message (typically single chunk)
 */
function chunkMessage(conversationId, roundNumber, speaker, content) {
  return [{
    content,
    location: {
      type: 'conversation',
      conversationId,
      round: roundNumber,
      speaker
    },
    index: 0,
    tokenCount: estimateTokens(content)
  }];
}

module.exports = {
  chunkFile,
  chunkMessage,
  estimateTokens
};
