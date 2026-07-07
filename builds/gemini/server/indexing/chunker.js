/**
 * Estimate tokens in text (rough approximation)
 * ~4 characters per token for English
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks of ~maxTokens
 * Tries to split on natural boundaries (lines)
 */
function chunkText(text, maxTokens = 500) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      // Chunk is full, save it
      chunks.push({
        content: currentChunk.join('\n'),
        token_count: currentTokens
      });

      currentChunk = [line];
      currentTokens = lineTokens;
    } else {
      currentChunk.push(line);
      currentTokens += lineTokens;
    }
  }

  // Save remaining
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      token_count: currentTokens
    });
  }

  return chunks;
}

/**
 * Split content by lines for line-based results
 */
function chunkByLines(text, linesPerChunk = 50) {
  const lines = text.split('\n');
  const chunks = [];

  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const chunkLines = lines.slice(i, i + linesPerChunk);
    chunks.push({
      content: chunkLines.join('\n'),
      start_line: i + 1,
      end_line: i + chunkLines.length,
      token_count: estimateTokens(chunkLines.join('\n'))
    });
  }

  return chunks;
}

module.exports = {
  estimateTokens,
  chunkText,
  chunkByLines
};
