const { executeBash } = require('./docker');

/**
 * Tool definition for bash execution
 */
const BASH_TOOL = {
  name: 'bash',
  description: 'Execute bash commands in the project directory. Use this to create files, run scripts, install packages, analyze data, etc. Commands run in a sandboxed Docker container with access to the project directory.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute. Can be multiline. Working directory is /project.'
      }
    },
    required: ['command']
  }
};

/**
 * Execute a tool call
 */
async function executeTool(toolName, args, projectId, options = {}) {
  if (toolName === 'bash') {
    const { command } = args;
    if (!command) {
      throw new Error('bash tool requires command argument');
    }

    const result = await executeBash(command, projectId, options);

    // Format result for model
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      success: result.success
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = {
  BASH_TOOL,
  executeTool
};
