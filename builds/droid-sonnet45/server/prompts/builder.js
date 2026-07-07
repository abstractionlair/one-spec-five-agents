const { listMessages } = require('../conversations/writer');
const { readMessage } = require('../conversations/reader');
const { getProject } = require('../db/projects');
const { listFiles } = require('../files/storage');

/**
 * Build messages for a model, including conversation history and system prompt
 */
async function buildMessages({ conversationId, provider, modelId, roundNumber }) {
  // Get conversation messages up to this round
  const allMessages = listMessages(conversationId);
  const relevantMessages = allMessages.filter(msg => msg.round_number <= roundNumber);

  // Load content for each message
  const messagesWithContent = await Promise.all(
    relevantMessages.map(msg => readMessage(msg.id))
  );

  // Get conversation and project info
  const { getConversation } = require('../conversations/writer');
  const conversation = getConversation(conversationId);
  const project = getProject(conversation.project_id);

  // Get file listing
  const files = listFiles(conversation.project_id);
  const fileList = files
    .map(f => `- ${f.path} (${f.size_bytes} bytes)`)
    .join('\n');

  // Build system prompt
  const systemPrompt = `You are ${modelId} assisting with project "${project.name}".

PROJECT CONTEXT:
- Working directory: /project/
- You have access to a bash tool for executing commands
- Commands run in a sandboxed Docker container

BASH TOOL USAGE:
You can execute bash commands to:
- Analyze data files
- Run Python/Node.js scripts
- Install packages (use python3 -m venv .venv for Python)
- Create and modify files
- Perform calculations

AVAILABLE FILES (${files.length} total):
${fileList || '(no files yet)'}

CONVERSATION:
This is round ${roundNumber} of the conversation.
`;

  // Build message history
  const messages = [];

  // For providers that support system messages in the messages array
  if (provider === 'openai') {
    messages.push({
      role: 'system',
      content: systemPrompt
    });
  }

  // Add conversation messages
  for (const msg of messagesWithContent) {
    if (msg.speaker === 'user') {
      messages.push({
        role: 'user',
        content: msg.content
      });
    } else {
      // Agent message
      messages.push({
        role: 'assistant',
        content: msg.content
      });
    }
  }

  // Return based on provider
  if (provider === 'anthropic') {
    // Anthropic uses separate system parameter
    return {
      system: systemPrompt,
      messages: messages
    };
  }

  return {
    messages,
    system: systemPrompt  // Include for reference even if not used
  };
}

module.exports = { buildMessages };
