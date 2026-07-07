const { GoogleGenerativeAI } = require('@google/generative-ai');
const { bashToolGoogle, executeTool } = require('../execution/tools');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Call Google model with tool support
 */
async function callGoogle(messages, modelId, projectId, options = {}) {
  const {
    temperature = 0.7,
    maxTokens = 4096,
    tools = [bashToolGoogle]
  } = options;

  const model = genAI.getGenerativeModel({
    model: modelId,
    tools: [{ functionDeclarations: tools }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens
    }
  });

  const toolCalls = [];
  let finalResponse = null;

  // Convert messages to Google format
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const lastMessage = messages[messages.length - 1].content;

  const chat = model.startChat({ history });

  // Tool calling loop
  const maxIterations = 10;
  for (let i = 0; i < maxIterations; i++) {
    const result = await chat.sendMessage(lastMessage || '');
    const response = result.response;

    // Check for function calls
    const functionCalls = response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      // Execute each function call
      const functionResults = [];

      for (const functionCall of functionCalls) {
        const toolName = functionCall.name;
        const toolArgs = functionCall.args;

        console.log(`[Google] Tool call: ${toolName}`, toolArgs);

        try {
          const result = await executeTool(toolName, toolArgs, projectId);

          toolCalls.push({
            tool: toolName,
            args: toolArgs,
            result
          });

          functionResults.push({
            functionResponse: {
              name: toolName,
              response: result
            }
          });
        } catch (err) {
          console.error(`[Google] Tool execution error:`, err);
          functionResults.push({
            functionResponse: {
              name: toolName,
              response: { error: err.message }
            }
          });
        }
      }

      // Send function results back
      const followUpResult = await chat.sendMessage(functionResults);
      const followUpResponse = followUpResult.response;

      // Check if there are more function calls
      if (followUpResponse.functionCalls()) {
        continue;
      }

      // Get final text response
      finalResponse = {
        content: followUpResponse.text(),
        usage: {
          input_tokens: followUpResult.response.usageMetadata?.promptTokenCount || 0,
          output_tokens: followUpResult.response.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: followUpResult.response.usageMetadata?.totalTokenCount || 0
        },
        toolCalls
      };
      break;
    }

    // No function calls, we have the final response
    finalResponse = {
      content: response.text(),
      usage: {
        input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
        output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: result.response.usageMetadata?.totalTokenCount || 0
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

module.exports = { callGoogle };
