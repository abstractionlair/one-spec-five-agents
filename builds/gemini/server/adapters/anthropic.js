const Anthropic = require('@anthropic-ai/sdk');
const { BASH_TOOL } = require('../execution/tools');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Convert bash tool to Anthropic format
 */
function formatToolForAnthropic(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  };
}

/**
 * Send messages to Anthropic with tool support
 */
async function sendAnthropic({ model, messages, system, tools = [], onToolCall }) {
  const anthropicMessages = messages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

  const anthropicTools = tools.map(formatToolForAnthropic);

  let response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: anthropicMessages,
    tools: anthropicTools.length > 0 ? anthropicTools : undefined
  });

  let usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens
  };

  // Handle tool use (with loop limit to prevent infinite loops)
  let toolCallIterations = 0;
  const MAX_TOOL_ITERATIONS = 10;

  while (response.stop_reason === 'tool_use' && toolCallIterations < MAX_TOOL_ITERATIONS) {
    toolCallIterations++;
    // Find tool use blocks
    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

    // Execute tools
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const result = await onToolCall(toolUse.name, toolUse.input);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result)
      });
    }

    // Add assistant message
    anthropicMessages.push({
      role: 'assistant',
      content: response.content
    });

    // Add tool results
    anthropicMessages.push({
      role: 'user',
      content: toolResults
    });

    // Continue conversation
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: anthropicMessages,
      tools: anthropicTools
    });

    // Accumulate usage
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
  }

  // Check if we hit the iteration limit
  if (toolCallIterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`Tool call loop limit reached (${MAX_TOOL_ITERATIONS} iterations)`);
    // Extract any text we have so far
    const textBlocks = response.content.filter(block => block.type === 'text');
    const partialText = textBlocks.length > 0 
      ? textBlocks.map(block => block.text).join('\n')
      : '[Tool call limit reached - conversation stopped to prevent infinite loop]';
    return {
      text: partialText,
      usage,
      warning: 'Maximum tool call iterations reached'
    };
  }

  // Extract text from content blocks
  const textBlocks = response.content.filter(block => block.type === 'text');
  const text = textBlocks.map(block => block.text).join('\n');

  return {
    text,
    usage
  };
}

module.exports = { sendAnthropic };
