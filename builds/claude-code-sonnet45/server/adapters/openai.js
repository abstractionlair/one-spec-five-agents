const OpenAI = require('openai');
const { bashToolOpenAI, executeTool } = require('../execution/tools');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Call OpenAI model with tool support
 */
async function callOpenAI(messages, modelId, projectId, options = {}) {
  const {
    temperature = 0.7,
    maxTokens = 4096,
    tools = [bashToolOpenAI]
  } = options;

  const toolCalls = [];
  let finalResponse = null;
  let currentMessages = [...messages];

  // Tool calling loop
  const maxIterations = 10;
  for (let i = 0; i < maxIterations; i++) {
    const response = await openai.chat.completions.create({
      model: modelId,
      messages: currentMessages,
      tools: tools,
      temperature,
      max_tokens: maxTokens
    });

    const message = response.choices[0].message;
    const usage = response.usage;

    // Add assistant message to conversation
    currentMessages.push(message);

    // Check if model wants to use tools
    if (message.tool_calls && message.tool_calls.length > 0) {
      // Execute each tool call
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        console.log(`[OpenAI] Tool call: ${toolName}`, toolArgs);

        try {
          const result = await executeTool(toolName, toolArgs, projectId);

          toolCalls.push({
            tool: toolName,
            args: toolArgs,
            result
          });

          // Add tool result to messages
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        } catch (err) {
          console.error(`[OpenAI] Tool execution error:`, err);
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: err.message })
          });
        }
      }

      // Continue loop to get next response
      continue;
    }

    // No more tool calls, we have the final response
    finalResponse = {
      content: message.content,
      usage: {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      },
      toolCalls
    };
    break;
  }

  if (!finalResponse) {
    throw new Error('Max tool calling iterations reached');
  }

  return finalResponse;
}

module.exports = { callOpenAI };
