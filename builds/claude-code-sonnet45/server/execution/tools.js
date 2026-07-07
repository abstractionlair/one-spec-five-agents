const { executeBash } = require('./docker');

/**
 * Tool definitions for model providers
 */

/**
 * Bash tool definition (OpenAI format)
 */
const bashToolOpenAI = {
  type: 'function',
  function: {
    name: 'bash',
    description: 'Execute bash commands in a sandboxed Docker container with access to the project directory. Use this to run Python scripts, Node.js code, install packages, manipulate files, analyze data, etc. The working directory is /project which is mounted from the host filesystem, so files you create will persist.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute. Can include pipes, redirects, and multiple commands separated by &&. Examples: "python3 script.py", "npm install lodash && node app.js", "source .venv/bin/activate && pip install pandas"'
        }
      },
      required: ['command']
    }
  }
};

/**
 * Bash tool definition (Anthropic format)
 */
const bashToolAnthropic = {
  name: 'bash',
  description: 'Execute bash commands in a sandboxed Docker container with access to the project directory. Use this to run Python scripts, Node.js code, install packages, manipulate files, analyze data, etc. The working directory is /project which is mounted from the host filesystem, so files you create will persist.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute. Can include pipes, redirects, and multiple commands separated by &&. Examples: "python3 script.py", "npm install lodash && node app.js", "source .venv/bin/activate && pip install pandas"'
      }
    },
    required: ['command']
  }
};

/**
 * Bash tool definition (Google format)
 */
const bashToolGoogle = {
  name: 'bash',
  description: 'Execute bash commands in a sandboxed Docker container with access to the project directory. Use this to run Python scripts, Node.js code, install packages, manipulate files, analyze data, etc. The working directory is /project which is mounted from the host filesystem, so files you create will persist.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute. Can include pipes, redirects, and multiple commands separated by &&. Examples: "python3 script.py", "npm install lodash && node app.js", "source .venv/bin/activate && pip install pandas"'
      }
    },
    required: ['command']
  }
};

/**
 * Execute a tool call
 */
async function executeTool(toolName, args, projectId) {
  if (toolName === 'bash') {
    const result = await executeBash(args.command, projectId);
    return {
      success: result.success,
      output: result.stdout,
      error: result.stderr,
      exit_code: result.exit_code
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = {
  bashToolOpenAI,
  bashToolAnthropic,
  bashToolGoogle,
  executeTool
};
