const { getProject } = require('../db/projects');
const { listFiles } = require('../files/storage');

/**
 * Build system prompt with project context
 */
function buildSystemPrompt(projectId, conversationId, options = {}) {
  const project = getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const files = listFiles(projectId);
  const {
    maxFiles = 50,
    provider = 'openai'
  } = options;

  // Build file listing (truncated if too many)
  const fileList = files
    .slice(0, maxFiles)
    .map(f => {
      const sizeKB = (f.size_bytes / 1024).toFixed(1);
      return `- ${f.path} (${sizeKB}KB)`;
    })
    .join('\n');

  const moreFiles = files.length > maxFiles ? `\n... and ${files.length - maxFiles} more files` : '';

  const basePrompt = `You are an AI assistant helping with the "${project.name}" project.

PROJECT CONTEXT:
You have access to a project directory with ${files.length} file(s).

BASH TOOL:
You can execute bash commands in a sandboxed Docker container. The working directory is /project, which is mounted from the host filesystem.

Available tools:
- Python 3 with venv support: python3 -m venv .venv && source .venv/bin/activate && pip install <packages>
- Node.js with npm: npm install <packages> && node script.js
- Pixi package manager: pixi init && pixi add python=3.11 pandas && pixi run python script.py
- Standard Unix utilities: grep, awk, sed, curl, wget, git, etc.

Files you create or modify will persist in the project directory.

PROJECT FILES${files.length > 0 ? ':' : ' (empty)'}
${fileList}${moreFiles}

INSTRUCTIONS:
1. Use bash to analyze data, run scripts, install packages, and manipulate files
2. When writing code, save it to files in the project directory
3. Provide clear explanations of what you're doing
4. If you encounter errors, debug and fix them
5. Show your work and results

Current conversation ID: ${conversationId}`;

  return basePrompt;
}

/**
 * Build message array with system prompt for provider
 */
function buildMessagesWithSystem(messages, systemPrompt, provider) {
  if (provider === 'anthropic') {
    // Anthropic uses separate system parameter
    return {
      system: systemPrompt,
      messages: messages.filter(m => m.role !== 'system')
    };
  }

  // OpenAI and Google include system as first message
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.filter(m => m.role !== 'system')
    ]
  };
}

module.exports = {
  buildSystemPrompt,
  buildMessagesWithSystem
};
