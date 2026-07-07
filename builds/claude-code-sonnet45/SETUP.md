# Multi-Model Chat - Setup Guide

## ✅ Implementation Complete!

All 8 core steps have been implemented (Steps 01-08). The system is now ready for setup and testing.

---

## 🔧 Required Setup Steps

### 1. Fix npm install

The npm install is failing because node-gyp can't detect Xcode Command Line Tools properly. Try these solutions:

**Option A: Point xcode-select to the correct location**
```bash
# Find Xcode location
xcode-select -p

# If it shows /Library/Developer/CommandLineTools, try:
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer

# Or if you only have CLT:
sudo xcode-select --switch /Library/Developer/CommandLineTools

# Clear npm cache and retry
npm cache clean --force
npm install
```

**Option B: Reinstall Command Line Tools**
```bash
# Remove existing tools
sudo rm -rf /Library/Developer/CommandLineTools

# Reinstall
xcode-select --install

# After installation completes:
cd "/Volumes/Share 1/Projects/multi-model-chat-claude-code-sonnet45"
npm install
```

**Option C: Use prebuilt binaries (faster)**
```bash
# Install better-sqlite3 with prebuilt binaries
npm install better-sqlite3 --build-from-source=false

# Then install the rest
npm install
```

### 2. Set up API Keys

Create a `.env` file with your API keys:

```bash
cp .env.example .env
# Edit .env and add your keys:
```

```env
# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 3. Build Docker Image

```bash
cd server/execution
docker build -t multimodelchat-executor .
cd ../..
```

This may take 5-10 minutes for the first build.

### 4. Initialize Database

```bash
# This will run migrations automatically when you start the server
npm start
```

Or test the database separately:
```bash
npm run test:schema
```

---

## 🚀 Running the System

### Start the Server

```bash
npm start
```

You should see:
```
✓ Database initialized

🚀 Multi-Model Chat Server
   Port: 3000
   API:  http://localhost:3000/api
   Web:  http://localhost:3000
```

### Access the Web UI

Open http://localhost:3000 in your browser.

---

## 🧪 Testing

### Test Individual Components

```bash
# Test database (requires npm install to work)
npm run test:schema

# Test file storage
npm run test:files

# Test conversations
npm run test:conversations

# Test Docker execution
npm run test:docker
```

### Test End-to-End

1. **Via Web UI:**
   - Open http://localhost:3000
   - Create a new project
   - Create a new conversation
   - Select one or more models (GPT-4o, Claude, Gemini)
   - Send a message like: "Write a Python script that prints 'Hello World' and run it using bash"
   - The model should execute the code and show results

2. **Via API:**
   ```bash
   # Create a project
   curl -X POST http://localhost:3000/api/projects \
     -H 'Content-Type: application/json' \
     -d '{"name": "Test Project"}' \
     | jq

   # Get the project ID from the response, then send a turn
   curl -X POST http://localhost:3000/api/turn \
     -H 'Content-Type: application/json' \
     -d '{
       "projectId": "proj_...",
       "userMessage": "Write and run a simple Python script",
       "targetModels": [{"provider": "openai", "modelId": "gpt-4o"}]
     }' \
     | jq
   ```

---

## 📁 Project Structure (Final)

```
server/
├── db/                     # Database layer
│   ├── schema.sql          # Complete schema with FTS5
│   ├── index.js            # SQLite connection
│   ├── migrations.js       # Migration system
│   ├── projects.js         # Project CRUD
│   ├── config.js           # Config management
│   └── test-schema.js      # Database tests
├── files/                  # File storage
│   ├── storage.js          # File operations
│   └── routes.js           # File API endpoints
├── conversations/          # Conversation management
│   ├── writer.js           # Save messages to markdown
│   ├── reader.js           # Read messages from markdown
│   └── routes.js           # Conversation API endpoints
├── execution/              # Docker execution
│   ├── Dockerfile          # Container image
│   ├── docker.js           # Docker executor
│   ├── tools.js            # Tool definitions
│   └── test-docker.js      # Docker tests
├── adapters/               # Model provider adapters
│   ├── openai.js           # OpenAI with tool calling
│   ├── anthropic.js        # Anthropic with tool calling
│   └── google.js           # Google with tool calling
├── indexing/               # Search and indexing
│   ├── chunker.js          # Content chunking
│   ├── indexer.js          # FTS5 indexing
│   └── search.js           # Search API
├── prompts/                # System prompts
│   └── builder.js          # Prompt construction
├── routes/                 # API routes
│   ├── projects.js         # Project routes
│   └── turn.js             # Main /api/turn endpoint
├── utils/                  # Utilities
│   ├── hash.js             # Content hashing
│   ├── sanitize.js         # Path sanitization
│   └── yaml.js             # YAML parser/formatter
└── server.js               # Main Express app

web/
├── index.html              # Web UI
├── app.js                  # Client-side JavaScript
└── styles.css              # Styling

projects/                   # User data (gitignored)
storage/                    # Database (gitignored)
```

---

## 🎯 Features Implemented

### Core Features
- ✅ SQLite database with FTS5 full-text search
- ✅ Project and conversation management
- ✅ File storage on filesystem with metadata in DB
- ✅ Markdown conversations with YAML frontmatter
- ✅ Docker-based code execution (sandboxed)
- ✅ Multi-model support (OpenAI, Anthropic, Google)
- ✅ Tool calling (bash execution in containers)
- ✅ System prompts with project context
- ✅ Search across files and conversations
- ✅ Web UI for chat interface

### API Endpoints
- Projects: `GET/POST/PUT/DELETE /api/projects`
- Files: `POST/GET/DELETE /api/projects/:id/files`
- Conversations: `POST/GET /api/conversations`
- Messages: `POST /api/conversations/:id/messages`
- Turn: `POST /api/turn` (main conversation endpoint)
- Search: `POST /api/projects/:id/search`

---

## 🚨 Troubleshooting

### npm install fails
See "Fix npm install" section above. The most common fix is Option B (reinstall CLT).

### Docker build fails
- Make sure Docker Desktop is installed and running
- Try: `docker system prune -a` to clear old builds
- Check Docker has enough disk space

### "Database is locked" error
- Stop all running server instances
- Delete `storage/data.db-wal` and `storage/data.db-shm`
- Restart server

### Models not responding
- Check your API keys in `.env`
- Check API key permissions
- Check network connectivity
- Check console logs for specific errors

### Docker commands timeout
- Increase timeout in options: `{ timeout: 120000 }` (2 minutes)
- Check Docker resource limits in Docker Desktop settings
- Some operations (like pip install) can be slow on first run

---

## 🔄 Next Steps (Optional Enhancements)

### Immediate Improvements
1. **Add conversation indexing hooks** - Auto-index messages as they're created
2. **Add file indexing hooks** - Auto-index files as they're uploaded
3. **Better error handling** - More detailed error messages in UI
4. **Streaming responses** - Show model responses as they're generated

### Future Features (Step 09)
- Conversation summarization for long chats
- Context window management
- Token counting and cost tracking
- Export conversations to markdown
- Import existing conversations

### Production Enhancements
- User authentication
- Multi-user support
- Conversation sharing
- Model response caching
- Rate limiting

---

## 📊 Testing Checklist

- [ ] npm install completes successfully
- [ ] Database initializes (run server, check for "✓ Database initialized")
- [ ] Can create a project via UI
- [ ] Can create a conversation via UI
- [ ] Can send a message to GPT-4o
- [ ] Can send a message to Claude
- [ ] Can send a message to Gemini
- [ ] Model can execute bash commands
- [ ] Model can create and run Python scripts
- [ ] Model can create and run Node.js scripts
- [ ] File uploads work
- [ ] Search works (after indexing is added)
- [ ] Conversation history persists
- [ ] Multiple models can respond to same message

---

## 🎉 Success!

Once you've completed the setup steps and tests pass, you have a fully functional multi-model chat system with code execution capabilities!

Try asking the models to:
- Analyze CSV data
- Generate and run Python scripts
- Install and use npm packages
- Create visualizations
- Process files in the project directory
- And much more!

---

**For questions or issues, check:**
- Console logs (browser and server)
- `storage/data.db` (inspect with `sqlite3 storage/data.db`)
- Project files in `projects/{project-id}/files/`
- Conversation markdown in `projects/{project-id}/files/.conversations/`
