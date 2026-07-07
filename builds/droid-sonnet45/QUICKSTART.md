# Multi-Model Chat - Quickstart Guide

A multi-model chat system that lets you query multiple AI models simultaneously, with filesystem storage and Docker-based code execution.

## Features

✅ **Multi-model queries** - Send the same question to multiple AI models and compare responses
✅ **Code execution** - Models can run bash commands in sandboxed Docker containers  
✅ **Filesystem storage** - Files and conversations stored as actual files (not database BLOBs)
✅ **Markdown conversations** - Conversation history in human-readable .md files with YAML frontmatter
✅ **Tool calling** - Models can execute code, install packages, analyze data, create files
✅ **Usage tracking** - Token usage recorded for all model interactions

## Prerequisites

1. **Node.js 18+** - For running the server
2. **Docker** (optional) - Required for bash tool execution by models
3. **API Keys** - At least one of:
   - OpenAI API key (for GPT models)
   - Anthropic API key (for Claude models)

## Quick Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

### 3. Start the Server

```bash
npm start
```

The server will start at `http://localhost:3000`

### 4. Open the Web Interface

Navigate to `http://localhost:3000` in your browser.

## Usage

### Creating a Project

Projects are workspaces that contain files and conversations.

**Via Web UI:**
1. Click "Create New Project"
2. Enter a project name
3. The project ID will be filled in automatically

**Via API:**
```bash
curl -X POST http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name": "My Project", "description": "Testing multi-model chat"}'
```

### Sending Messages

**Via Web UI:**
1. Enter your project ID
2. Select target models (e.g., `openai/gpt-4o-mini`)
3. Type your message
4. Click "Send Message"

**Via API:**
```bash
curl -X POST http://localhost:3000/api/turn \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "proj_...",
    "userMessage": "What is 2+2?",
    "targetModels": [
      {"provider": "openai", "modelId": "gpt-4o-mini"}
    ]
  }'
```

### Using the Bash Tool

Models can execute bash commands automatically. Try asking:

- "Create a Python script that calculates fibonacci numbers"
- "Analyze the data in sales.csv and show me the top 5 entries"
- "Install the requests library and fetch data from an API"

The model will use the bash tool to:
1. Create necessary files
2. Install required packages
3. Run the code
4. Return results

### Project Structure

```
projects/
  proj_abc123/
    files/
      .venv/              # Python virtual environments
      node_modules/       # npm packages
      .conversations/     # Markdown conversation history
      data/               # Your data files
      scripts/            # Scripts created by models
```

## API Endpoints

### Projects
- `POST /api/projects` - Create a project
- `GET /api/projects` - List all projects
- `GET /api/projects/:id` - Get project details

### Files
- `POST /api/projects/:id/files` - Upload a file
- `POST /api/projects/:id/files/text` - Create a text file
- `GET /api/projects/:id/files` - List files in project
- `GET /api/files/:id` - Get file metadata
- `GET /api/files/:id/content` - Get file content
- `DELETE /api/files/:id` - Delete file

### Conversations
- `POST /api/conversations` - Create a conversation
- `GET /api/conversations?projectId=X` - List conversations
- `GET /api/conversations/:id` - Get conversation with messages
- `POST /api/conversations/:id/messages` - Add a message

### Multi-Model Query
- `POST /api/turn` - Send message to multiple models

## Testing

Run the test suites:

```bash
# Test database schema
npm run test:schema

# Test file storage
npm run test:files

# Test conversations
npm run test:conversations

# Test Docker execution (requires Docker)
npm run test:docker
```

## Troubleshooting

### "Database not initialized"
Wait a moment for the database to initialize. The server logs will show "✓" when ready.

### "API key not found"
Make sure your `.env` file has the correct API keys and restart the server.

### "Docker not available"
The bash tool requires Docker to be installed and running. Install Docker Desktop or the system will work without code execution capability.

### "Permission denied" on files
Check that the `projects/` directory has correct permissions.

## Architecture Notes

- **Database**: SQLite (via sql.js) for metadata only
- **Storage**: Filesystem for files and conversations
- **Execution**: Docker containers (ephemeral, resource-limited)
- **Models**: Provider-agnostic adapters (OpenAI, Anthropic, extendable)

## Development

See `ARCHITECTURE.md` and `CLAUDE.md` for detailed technical documentation.

## License

MIT
