const Anthropic = require('@anthropic-ai/sdk');
const { bashToolAnthropic, executeTool } = require('../execution/tools');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Call Anthropic model with tool support
 */
async function callAnthropic(messages, modelId, projectId, systemPrompt = '', options = {}) {
  const {
    temperature = 0.7,
    maxTokens = 4096,
    tools = [bashToolAnthropic]
  } = options;

  const toolCalls = [];
  let finalResponse = null;

  // Convert messages to Anthropic format (remove system messages)
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

  // Tool calling loop
  const maxIterations = 10;
  let currentMessages = [...anthropicMessages];

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model: modelId,
      system: systemPrompt,
      messages: currentMessages,
      tools: tools,
      temperature,
      max_tokens: maxTokens
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens
    };

    // Check for tool use
    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

    if (toolUseBlocks.length > 0) {
      // Add assistant message with tool use
      currentMessages.push({
        role: 'assistant',
        content: response.content
      });

      // Execute tools and collect results
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name;
        const toolArgs = toolUse.input;

        console.log(`[Anthropic] Tool call: ${toolName}`, toolArgs);

        try {
          const result = await executeTool(toolName, toolArgs, projectId);

          toolCalls.push({
            tool: toolName,
            args: toolArgs,
            result
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        } catch (err) {
          console.error(`[Anthropic] Tool execution error:`, err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true
          });
        }
      }

      // Add tool results as user message
      currentMessages.push({
        role: 'user',
        content: toolResults
      });

      // Continue loop
      continue;
    }

    // No tool use, extract text response
    const textBlock = response.content.find(block => block.type === 'text');
    finalResponse = {
      content: textBlock ? textBlock.text : '',
      usage,
      toolCalls
    };
    break;
  }

  if (!finalResponse) {
    throw new Error('Max tool calling iterations reached');
  }

  return finalResponse;
}

module.exports = { callAnthropic };
