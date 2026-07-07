const OpenAI = require('openai');
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

async function sendOpenAI({ model, messages, tools = [], onToolCall }) {
  const openaiMessages = messages.map((msg) => ({
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
    input_tokens: completion.usage?.prompt_tokens || 0,
    output_tokens: completion.usage?.completion_tokens || 0
  };

  let toolCallIterations = 0;
  const MAX_TOOL_ITERATIONS = 10;

  while (completion.choices[0].finish_reason === 'tool_calls' && toolCallIterations < MAX_TOOL_ITERATIONS) {
    toolCallIterations++;
    const toolCalls = completion.choices[0].message.tool_calls;

    const toolResults = [];
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      const result = await onToolCall(toolCall.function.name, args);
      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify(result)
      });
    }

    openaiMessages.push(completion.choices[0].message);
    openaiMessages.push(...toolResults);

    completion = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto'
    });

    usage.input_tokens += completion.usage?.prompt_tokens || 0;
    usage.output_tokens += completion.usage?.completion_tokens || 0;
  }

  if (toolCallIterations >= MAX_TOOL_ITERATIONS) {
    const partialText =
      completion.choices[0].message.content ||
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
