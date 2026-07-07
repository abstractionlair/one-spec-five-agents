/**
 * Base system prompt (provider-agnostic)
 */
function baseSystemPrompt({ projectName, modelId, fileList, roundNumber }) {
  const fileListStr = fileList.length > 0
    ? fileList.slice(0, 20).map(f => `- ${f.path} (${formatBytes(f.size_bytes)})`).join('\n') +
      (fileList.length > 20 ? `\n... and ${fileList.length - 20} more files` : '')
    : '(No files in project)';

  return 'You are ' + modelId + ' participating in a multi-model conversation about the "' + projectName + '" project.\n\n' +
    '## Project Context\n\n' +
    'You have access to the project directory via the bash tool. The project currently contains ' + fileList.length + ' file(s):\n\n' +
    fileListStr + '\n\n' +
    '## Bash Tool Usage\n\n' +
    'You have access to a bash tool that executes commands in a sandboxed Docker container:\n\n' +
    '**Working Directory:** /project\n' +
    '**Persistent Storage:** Files you create persist between commands\n' +
    '**Network Access:** Enabled by default for installing packages and fetching data (can be disabled per project)\n\n' +
    '### Creating Python Environment\n\n' +
    '```bash\n' +
    '# Create virtual environment\n' +
    'python3 -m venv .venv\n\n' +
    '# Activate and install packages\n' +
    'source .venv/bin/activate && pip install pandas numpy matplotlib\n\n' +
    '# Run scripts\n' +
    'source .venv/bin/activate && python analyze.py\n' +    '```\n\n' +
    'Or use pixi for conda-like environments:\n\n' +
    '```bash\n' +
    '# Initialize pixi environment\n' +
    'pixi init\n\n' +
    '# Add packages\n' +
    'pixi add python=3.11 pandas numpy matplotlib\n\n' +
    '# Run commands\n' +
    'pixi run python analyze.py\n' +    '```\n' +
    'Pixi is optional and more advanced. Prefer plain `python3 -m venv` unless you specifically need pixi-style workflows.\n\n' +
    '### Node.js / npm\n\n' +
    '```bash\n' +
    '# Initialize package.json\n' +
    'npm init -y\n\n' +
    '# Install packages\n' +
    'npm install lodash axios\n\n' +
    '# Run scripts\n' +
    'node script.js\n' +    '```\n\n' +
    '### Best Practices\n\n' +
    '- Install packages into project directory (.venv, node_modules)\n' +
    '- Environments persist across tool calls\n' +
    '- Check if files exist before creating them\n' +
    '- Use relative paths\n' +
    '- Handle errors gracefully\n\n' +
    '## Conversation Context\n\n' +
    'This is round ' + roundNumber + ' of the conversation.' + (roundNumber > 1 ? ' Previous messages are in the conversation history.' : '') + '\n';
}

/**
 * OpenAI-specific system prompt
 */
function openaiSystemPrompt(context) {
  return baseSystemPrompt(context) + `

## Response Format

Provide clear, concise responses. Use the bash tool when you need to:
- Read or analyze files
- Create or modify code
- Install dependencies
- Run scripts or calculations

Be explicit about what you're doing and why.`;
}

/**
 * Anthropic-specific system prompt
 */
function anthropicSystemPrompt(context) {
  return baseSystemPrompt(context) + `

## Response Guidelines

Use the bash tool proactively when it would help answer the user's question. For example:
- If asked about data, read and analyze it
- If asked to create something, build it
- If code needs testing, run it

Explain your reasoning and show your work.`;
}

/**
 * Format bytes for display
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

module.exports = {
  openaiSystemPrompt,
  anthropicSystemPrompt,
  formatBytes
};
