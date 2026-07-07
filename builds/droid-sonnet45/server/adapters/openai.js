const OpenAI = require('openai');
const { BASH_TOOL } = require('../execution/tools');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Convert bash tool to OpenAI format
 */
function formatToolForOpenAI(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

/**
 * Send messages to OpenAI with tool support
 */
async function sendOpenAI({ model, messages, tools = [], onToolCall }) {
  const openaiMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  const openaiTools = tools.map(formatToolForOpenAI);

  let completion = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    tools: openaiTools.length > 0 ? openaiTools : undefined,
    tool_choice: openaiTools.length > 0 ? 'auto' : undefined
  });

  let usage = {
    input_tokens: completion.usage.prompt_tokens,
    output_tokens: completion.usage.completion_tokens
  };

  // Handle tool calls (with loop limit)
  let toolCallIterations = 0;
  const MAX_TOOL_ITERATIONS = 10;

  while (completion.choices[0].finish_reason === 'tool_calls' && toolCallIterations < MAX_TOOL_ITERATIONS) {
    toolCallIterations++;
    const toolCalls = completion.choices[0].message.tool_calls;

    // Execute tools
    const toolResults = [];
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await onToolCall(toolCall.function.name, args);

      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify(result)
      });
    }

    // Add assistant message with tool calls
    openaiMessages.push(completion.choices[0].message);

    // Add tool results
    openaiMessages.push(...toolResults);

    // Continue conversation
    completion = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto'
    });

    // Accumulate usage
    usage.input_tokens += completion.usage.prompt_tokens;
    usage.output_tokens += completion.usage.completion_tokens;
  }

  if (toolCallIterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`Tool call loop limit reached (${MAX_TOOL_ITERATIONS} iterations)`);
    const partialText = completion.choices[0].message.content || 
      '[Tool call limit reached - conversation stopped to prevent infinite loop]';
    return {
      text: partialText,
      usage,
      warning: 'Maximum tool call iterations reached'
    };
  }

  return {
    text: completion.choices[0].message.content,
    usage
  };
}

module.exports = { sendOpenAI };
