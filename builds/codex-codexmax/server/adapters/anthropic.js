const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

function formatToolForAnthropic(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  };
}

async function sendAnthropic({ model, messages, system, tools = [], onToolCall }) {
  const anthropicMessages = messages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => ({
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
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0
  };

  let toolCallIterations = 0;
  const MAX_TOOL_ITERATIONS = 10;

  while (response.stop_reason === 'tool_use' && toolCallIterations < MAX_TOOL_ITERATIONS) {
    toolCallIterations++;
    const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');

    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const result = await onToolCall(toolUse.name, toolUse.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result)
      });
    }

    anthropicMessages.push({
      role: 'assistant',
      content: response.content
    });

    anthropicMessages.push({
      role: 'user',
      content: toolResults
    });

    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: anthropicMessages,
      tools: anthropicTools
    });

    usage.input_tokens += response.usage?.input_tokens || 0;
    usage.output_tokens += response.usage?.output_tokens || 0;
  }

  if (toolCallIterations >= MAX_TOOL_ITERATIONS) {
    const textBlocks = response.content.filter((block) => block.type === 'text');
    const partialText =
      textBlocks.length > 0
        ? textBlocks.map((block) => block.text).join('\n')
        : '[Tool call limit reached - conversation stopped to prevent infinite loop]';
    return {
      text: partialText,
      usage,
      warning: 'Maximum tool call iterations reached'
    };
  }

  const textBlocks = response.content.filter((block) => block.type === 'text');
  const text = textBlocks.map((block) => block.text).join('\n');

  return {
    text,
    usage
  };
}

module.exports = { sendAnthropic };
