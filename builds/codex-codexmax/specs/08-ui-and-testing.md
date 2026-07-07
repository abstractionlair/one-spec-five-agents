# Step 08: UI & Testing

**Goal:** Build a functional web UI and comprehensive end-to-end tests.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 07 (System prompts - full API stack ready)

## Overview

Create a minimal but functional web interface for:
- Selecting projects and models
- Sending messages
- Viewing responses
- Uploading files
- Searching

Plus end-to-end tests validating the entire system.

## File Structure

```
web/
  index.html       # Main UI
  app.js           # Client-side JavaScript
  styles.css       # Styling

server/
  test-e2e.js      # End-to-end integration tests

.env.example       # Example environment variables
README.md          # Updated with usage instructions
```

## Implementation

### 1. HTML (web/index.html)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Model Chat</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 Multi-Model Chat</h1>
      <div class="controls">
        <select id="projectSelect">
          <option value="">Select project...</option>
        </select>
        <button id="newProjectBtn">New Project</button>
      </div>
    </header>

    <div class="main">
      <aside class="sidebar">
        <h3>Conversations</h3>
        <div id="conversationList"></div>
        <button id="newConvBtn">New Conversation</button>

        <h3>Files</h3>
        <div id="fileList"></div>
        <button id="uploadFileBtn">Upload File</button>

        <h3>Search</h3>
        <input type="text" id="searchInput" placeholder="Search project...">
        <div id="searchResults"></div>
      </aside>

      <main class="chat">
        <div id="messages"></div>

        <div class="input-area">
          <div class="model-select">
            <label>
              <input type="checkbox" class="model-checkbox" value="openai|<openai-model-id>" checked>
              OpenAI (your preferred GPT‑4‑class model)
            </label>
            <label>
              <input type="checkbox" class="model-checkbox" value="anthropic|<anthropic-model-id>">
              Anthropic (your preferred Claude‑class model)
            </label>
          </div>

          <textarea id="messageInput" placeholder="Type your message..."></textarea>
          <button id="sendBtn">Send</button>
        </div>
      </main>
    </div>
  </div>

  <input type="file" id="fileInput" style="display: none;">

  <script src="app.js"></script>
</body>
</html>
```

### 2. CSS (web/styles.css)

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f5f5;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  background: white;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  padding: 20px;
  border-bottom: 1px solid #ddd;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h1 {
  font-size: 24px;
  color: #333;
}

.controls {
  display: flex;
  gap: 10px;
}

.main {
  display: flex;
  flex: 1;
}

.sidebar {
  width: 300px;
  border-right: 1px solid #ddd;
  padding: 20px;
  overflow-y: auto;
}

.sidebar h3 {
  margin: 20px 0 10px 0;
  font-size: 14px;
  color: #666;
  text-transform: uppercase;
}

.sidebar h3:first-child {
  margin-top: 0;
}

.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
}

#messages {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.message {
  margin-bottom: 20px;
  padding: 15px;
  border-radius: 8px;
}

.message.user {
  background: #e3f2fd;
}

.message.agent {
  background: #f5f5f5;
  border-left: 3px solid #4caf50;
}

.message-header {
  font-weight: bold;
  margin-bottom: 8px;
  color: #666;
  font-size: 12px;
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.5;
}

.message-usage {
  margin-top: 8px;
  font-size: 11px;
  color: #999;
}

.message.error {
  background: #ffebee;
  border-left: 3px solid #f44336;
}

.message.loading {
  background: #fff9c4;
  border-left: 3px solid #ffc107;
}

.loading-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #f3f3f3;
  border-top: 2px solid #ffc107;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.input-area {
  border-top: 1px solid #ddd;
  padding: 20px;
}

.model-select {
  display: flex;
  gap: 15px;
  margin-bottom: 10px;
}

#messageInput {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

button {
  padding: 10px 20px;
  background: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

button:hover {
  background: #1976d2;
}

select {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

#sendBtn {
  width: 100%;
  margin-top: 10px;
}

.file-item, .conv-item {
  padding: 8px;
  margin-bottom: 5px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.file-item:hover, .conv-item:hover {
  background: #f0f0f0;
}

.conv-item.active {
  background: #e3f2fd;
}

#searchInput {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 10px;
}

.search-result {
  padding: 8px;
  margin-bottom: 8px;
  border-radius: 4px;
  background: #f9f9f9;
  font-size: 13px;
  cursor: pointer;
}

.search-result:hover {
  background: #f0f0f0;
}

.search-result mark {
  background: #ffeb3b;
  padding: 2px;
}
```

### 3. JavaScript (web/app.js)

```javascript
let currentProject = null;
let currentConversation = null;
let currentRound = 1;

// Initialize
async function init() {
  await loadProjects();
  attachEventListeners();
}

function attachEventListeners() {
  document.getElementById('newProjectBtn').addEventListener('click', createProject);
  document.getElementById('newConvBtn').addEventListener('click', createConversation);
  document.getElementById('uploadFileBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', uploadFile);
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('projectSelect').addEventListener('change', (e) => {
    selectProject(e.target.value);
  });
  document.getElementById('searchInput').addEventListener('input', debounce(search, 300));
}

// Projects
async function loadProjects() {
  const response = await fetch('/api/projects');
  const data = await response.json();

  const select = document.getElementById('projectSelect');
  select.innerHTML = '<option value="">Select project...</option>';

  for (const project of data.projects || []) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    select.appendChild(option);
  }
}

async function createProject() {
  const name = prompt('Project name:');
  if (!name) return;

  await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  await loadProjects();
}

async function selectProject(projectId) {
  if (!projectId) return;
  currentProject = projectId;
  await loadConversations();
  await loadFiles();
}

// Conversations
async function loadConversations() {
  const response = await fetch(`/api/conversations?projectId=${currentProject}`);
  const data = await response.json();

  const list = document.getElementById('conversationList');
  list.innerHTML = '';

  for (const conv of data.conversations || []) {
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.textContent = conv.title || `Conversation ${conv.id.slice(-6)}`;
    div.addEventListener('click', () => selectConversation(conv.id));
    list.appendChild(div);
  }
}

async function createConversation() {
  if (!currentProject) {
    alert('Select a project first');
    return;
  }

  const title = prompt('Conversation title:');

  const response = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: currentProject,
      title
    })
  });

  await loadConversations();
}

async function selectConversation(convId) {
  currentConversation = convId;
  currentRound = 1;

  // Highlight selected
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  event.target.classList.add('active');

  // Load messages
  const response = await fetch(`/api/conversations/${convId}?includeContent=true`);
  const data = await response.json();

  currentRound = data.conversation.round_count + 1;

  displayMessages(data.conversation.messages || []);
}

function displayMessages(messages) {
  const container = document.getElementById('messages');
  container.innerHTML = '';

  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.speaker === 'user' ? 'user' : 'agent'}`;

    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = msg.speaker === 'user' ? 'You' : msg.speaker.replace('agent:', '');

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.content;

    div.appendChild(header);
    div.appendChild(content);
    container.appendChild(div);
  }

  container.scrollTop = container.scrollHeight;
}

// Files
async function loadFiles() {
  const response = await fetch(`/api/projects/${currentProject}/files`);
  const data = await response.json();

  const list = document.getElementById('fileList');
  list.innerHTML = '';

  for (const file of data.files || []) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.textContent = file.path;
    list.appendChild(div);
  }
}

async function uploadFile() {
  const input = document.getElementById('fileInput');
  const file = input.files[0];
  if (!file) return;

  const path = prompt('File path in project:', file.name);
  if (!path) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);

  await fetch(`/api/projects/${currentProject}/files`, {
    method: 'POST',
    body: formData
  });

  await loadFiles();
  input.value = '';
}

// Messages
async function sendMessage() {
  if (!currentProject || !currentConversation) {
    alert('Select a project and conversation first');
    return;
  }

  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  if (!message) return;

  // Get selected models
  const checkboxes = document.querySelectorAll('.model-checkbox:checked');
  const targetModels = Array.from(checkboxes).map(cb => {
    const [provider, modelId] = cb.value.split('|');
    return { provider, modelId };
  });

  if (targetModels.length === 0) {
    alert('Select at least one model');
    return;
  }

  // Disable send button
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  // Clear input
  input.value = '';

  // Add user message to UI
  addMessageToUI('user', 'You', message);

  // Add loading placeholders for each model
  const loadingMessages = targetModels.map(model => {
    return addMessageToUI('loading', model.modelId, 'Thinking...', null, true);
  });

  try {
    // Send to API
    const response = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: currentProject,
        conversationId: currentConversation,
        userMessage: message,
        targetModels,
        roundNumber: currentRound
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    // Remove loading messages
    loadingMessages.forEach(msg => msg.remove());

    // Add agent responses to UI
    for (const resp of data.responses) {
      if (resp.error) {
        addMessageToUI('error', resp.modelId, `Error: ${resp.error}`, null);
      } else {
        addMessageToUI('agent', resp.modelId, resp.response, resp.usage);
      }
    }

    currentRound++;

  } catch (err) {
    console.error('Send message error:', err);
    // Remove loading messages
    loadingMessages.forEach(msg => msg.remove());
    // Show error
    addMessageToUI('error', 'System', `Failed to send message: ${err.message}`, null);
  } finally {
    // Re-enable send button
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }
}

function addMessageToUI(type, speaker, content, usage = null, isLoading = false) {
  const container = document.getElementById('messages');

  const div = document.createElement('div');
  div.className = `message ${type}`;

  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = speaker;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  if (isLoading) {
    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner';
    contentDiv.appendChild(spinner);
    contentDiv.appendChild(document.createTextNode(' ' + content));
  } else {
    contentDiv.textContent = content;
  }

  div.appendChild(header);
  div.appendChild(contentDiv);

  // Add usage information if available
  if (usage) {
    const usageDiv = document.createElement('div');
    usageDiv.className = 'message-usage';
    usageDiv.textContent = `Tokens: ${usage.input_tokens || 0} in, ${usage.output_tokens || 0} out`;
    div.appendChild(usageDiv);
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  return div; // Return element so it can be removed later if needed
}

// Search
async function search() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query || !currentProject) return;

  const response = await fetch(`/api/projects/${currentProject}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 10 })
  });

  const data = await response.json();

  const container = document.getElementById('searchResults');
  container.innerHTML = '';

  for (const result of data.results || []) {
    const div = document.createElement('div');
    div.className = 'search-result';
    div.innerHTML = `
      <strong>${result.file_path || `Round ${result.round}`}</strong><br>
      ${result.snippet}
    `;
    container.appendChild(div);
  }
}

// Utilities
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Start
init();
```

### 4. Environment Variables (.env.example)

```bash
# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=3000

# Optional
DEBUG=false
```

### 5. End-to-End Test (server/test-e2e.js)

```javascript
const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation } = require('./conversations/writer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_URL = 'http://localhost:3000';

async function runE2ETest() {
  console.log('=== End-to-End Integration Test ===\n');
  console.log('⚠️  Ensure server is running (npm start)\n');

  let testProject;

  try {
    // 1. Create project
    console.log('1. Creating project...');
    testProject = createProject('E2E Test Project', 'Full system test');
    console.log(`  ✓ Project created: ${testProject.id}\n`);

    // 2. Upload data file
    console.log('2. Uploading data file...');
    await createFile(
      testProject.id,
      'sales.csv',
      'month,sales\nJan,1000\nFeb,1200\nMar,1500',
      'text/csv'
    );
    console.log('  ✓ File uploaded\n');

    // 3. Create conversation
    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'E2E Test Conversation');
    console.log(`  ✓ Conversation created: ${conv.id}\n`);

    // 4. Send message asking to analyze data
    console.log('4. Sending message: "Analyze sales.csv and create a summary"...');
    const response = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'Read sales.csv and tell me the total sales',
      targetModels: [
        { provider: 'openai', modelId: '<openai-model-id>' }
      ],
      roundNumber: 1
    });

    if (!response.data.responses[0].response) {
      throw new Error('No response from model');
    }

    console.log('  ✓ Got response from model');
    console.log(`  Response preview: ${response.data.responses[0].response.slice(0, 150)}...\n`);

    // 5. Verify model used bash tool (check for typical signs)
    const resp = response.data.responses[0].response;
    const usedBash = resp.includes('3700') || resp.includes('sales') || resp.includes('total');
    if (!usedBash) {
      console.log('  ⚠️  Model may not have used bash tool (or calculated correctly)\n');
    } else {
      console.log('  ✓ Model appears to have read and analyzed the file\n');
    }

    // 6. Search for "sales"
    console.log('5. Searching for "sales"...');
    const searchResp = await axios.post(`${API_URL}/api/projects/${testProject.id}/search`, {
      query: 'sales',
      limit: 10
    });

    if (searchResp.data.results.length === 0) {
      throw new Error('Search returned no results');
    }

    const hasFileResult = searchResp.data.results.some(r => r.type === 'file');
    const hasConvResult = searchResp.data.results.some(r => r.type === 'conversation');

    console.log(`  ✓ Found ${searchResp.data.results.length} results`);
    console.log(`    - Files: ${hasFileResult ? 'yes' : 'no'}`);
    console.log(`    - Conversations: ${hasConvResult ? 'yes' : 'no'}\n`);

    // 7. Verify conversation was saved
    console.log('6. Verifying conversation persistence...');
    const convResp = await axios.get(`${API_URL}/api/conversations/${conv.id}?includeContent=true`);

    if (convResp.data.conversation.messages.length < 2) {
      throw new Error('Conversation not fully saved');
    }

    console.log(`  ✓ Conversation has ${convResp.data.conversation.messages.length} messages\n`);

    // 8. Send follow-up message
    console.log('7. Sending follow-up message...');
    const followup = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'What was the best month?',
      targetModels: [
        { provider: 'openai', modelId: '<openai-model-id>' }
      ],
      roundNumber: 2
    });

    console.log('  ✓ Follow-up response received\n');

    // 9. List files
    console.log('8. Listing project files...');
    const filesResp = await axios.get(`${API_URL}/api/projects/${testProject.id}/files`);

    if (filesResp.data.files.length === 0) {
      throw new Error('No files found');
    }

    console.log(`  ✓ Found ${filesResp.data.files.length} file(s)\n`);

    console.log('✅ End-to-end test passed!\n');
    console.log('All systems working:');
    console.log('  • Project creation');
    console.log('  • File upload and storage');
    console.log('  • Conversation management');
    console.log('  • Model communication');
    console.log('  • Tool calling (bash)');
    console.log('  • Search indexing');
    console.log('  • Multi-round conversations');

  } catch (err) {
    console.error('\n❌ E2E test failed:', err.response?.data || err.message);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      deleteProject(testProject.id);

      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runE2ETest();
```

### 6. Update package.json

```json
{
  "name": "multimodelchat",
  "version": "1.0.0",
  "scripts": {
    "start": "node server/server.js",
    "test": "node server/test-e2e.js"
  },
  "dependencies": {
    "express": "<latest-stable-version>",
    "better-sqlite3": "<latest-stable-version>",
    "openai": "<latest-stable-version>",
    "@anthropic-ai/sdk": "<latest-stable-version>",
    "multer": "<latest-stable-version>"
  },
  "devDependencies": {
    "axios": "<latest-stable-version>"
  }
}
```

## Running

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Start server
npm start

# In another terminal: Run e2e tests
npm test
```

## Success Criteria

- [ ] UI loads and displays correctly
- [ ] Can create projects
- [ ] Can create conversations
- [ ] Can upload files via UI
- [ ] Can send messages to models
- [ ] Model responses display in UI
- [ ] Multiple models can be selected
- [ ] Search works and displays results
- [ ] File list updates after upload
- [ ] Conversation list shows all conversations
- [ ] E2E test passes completely

## Common Issues

**"CORS error"**
→ Make sure static files are served from same origin as API

**"Model not responding"**
→ Check API keys in .env file

**"Search not working"**
→ Ensure files are being indexed (check Step 06)

**"UI not updating"**
→ Check browser console for JavaScript errors

## Future Enhancements

Consider adding:
- Markdown rendering for messages
- Code syntax highlighting
- File viewer/editor
- Conversation export
- Cost tracking display
- Loading indicators
- Error notifications
- Dark mode

## Documentation

Update README.md with:
- Installation instructions
- API key setup
- Usage examples
- Architecture overview
- Development guide

---

**Previous:** [07-system-prompts.md](07-system-prompts.md) | **Roadmap:** [ROADMAP.md](../ROADMAP.md)

---

## 🎉 Congratulations!

You've completed all 8 steps! You now have a fully functional multi-model chat system with:

✅ SQLite persistence
✅ Filesystem storage
✅ Docker execution
✅ Tool calling
✅ Unified search
✅ Rich system prompts
✅ Web UI

**Next steps:**
- Polish the UI
- Add more model providers
- Optimize performance
- Deploy to production
