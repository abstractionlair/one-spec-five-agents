function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function baseSystemPrompt({ projectName, modelId, fileList, roundNumber }) {
  return `You are ${modelId} participating in a multi-model conversation about the "${projectName}" project.

## Project Context

You have access to the project directory via the bash tool. The project currently contains ${fileList.length} file(s):

${fileList
    .slice(0, 20)
    .map((f) => `- ${f.path} (${formatBytes(f.size_bytes || 0)})`)
    .join('\n')}${fileList.length > 20 ? `\n... and ${fileList.length - 20} more files` : ''}

## Bash Tool Usage

You have access to a bash tool that executes commands in a sandboxed Docker container:

**Working Directory:** /project
**Persistent Storage:** Files you create persist between commands
**Network Access:** Enabled by default for installing packages and fetching data (can be disabled per project)

### Creating Python Environment

\`\`\`bash
# Create virtual environment
python3 -m venv .venv

# Activate and install packages
source .venv/bin/activate && pip install pandas numpy matplotlib

# Run scripts
source .venv/bin/activate && python analyze.py
\`\`\`

Or use pixi for conda-like environments:

\`\`\`bash
# Initialize pixi environment
pixi init

# Add packages (Python 3.x)
pixi add python=3.x pandas numpy matplotlib

# Run commands
pixi run python analyze.py
\`\`\`
Pixi is optional and more advanced. Prefer plain \`python3 -m venv\` unless you specifically need pixi-style workflows.

### Node.js / npm

\`\`\`bash
# Initialize package.json
npm init -y

# Install packages
npm install lodash axios

# Run scripts
node script.js
\`\`\`

### Best Practices

- Install packages into project directory (.venv, node_modules)
- Environments persist across tool calls
- Check if files exist before creating them
- Use relative paths
- Handle errors gracefully

## Conversation Context

This is round ${roundNumber} of the conversation.${roundNumber > 1 ? ' Previous messages are in the conversation history.' : ''}
`;
}

function openaiSystemPrompt(context) {
  return (
    baseSystemPrompt(context) +
    `

## Response Format

Provide clear, concise responses. Use the bash tool when you need to:
- Read or analyze files
- Create or modify code
- Install dependencies
- Run scripts or calculations

Be explicit about what you're doing and why.`
  );
}

function anthropicSystemPrompt(context) {
  return (
    baseSystemPrompt(context) +
    `

## Response Guidelines

Use the bash tool proactively when it would help answer the user's question. For example:
- If asked about data, read and analyze it
- If asked to create something, build it
- If code needs testing, run it

Explain your reasoning and show your work.`
  );
}

module.exports = {
  openaiSystemPrompt,
  anthropicSystemPrompt,
  formatBytes
};
