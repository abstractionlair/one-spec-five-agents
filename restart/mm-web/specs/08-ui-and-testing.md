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

Plus end-to-end tests validating the entire system using pytest.

## File Structure

```
web/
  index.html       # Main UI
  app.js           # Client-side JavaScript
  styles.css       # Styling

server/
  tests/
    test_e2e.py    # End-to-end integration tests
    conftest.py    # pytest fixtures

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
              <input type="checkbox" class="model-checkbox" value="openai|gpt-4o-mini" checked>
              GPT-4o Mini
            </label>
            <label>
              <input type="checkbox" class="model-checkbox" value="anthropic|claude-sonnet-4-5">
              Claude Sonnet 4.5
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

# Database
DATABASE_URL=postgresql://localhost/multimodelchat

# Server
HOST=0.0.0.0
PORT=8000

# Optional
DEBUG=false
```

### 5. pytest Configuration (server/tests/conftest.py)

```python
"""pytest fixtures for end-to-end tests."""

import asyncio
import shutil
from pathlib import Path
from typing import AsyncGenerator

import pytest
import httpx

from db import init_db, close_db
from db.projects import create_project, delete_project
from files.storage import PROJECTS_ROOT


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def db():
    """Initialize database for test session."""
    await init_db()
    yield
    await close_db()


@pytest.fixture
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Create async HTTP client for API calls."""
    async with httpx.AsyncClient(
        base_url="http://localhost:8000",
        timeout=60.0
    ) as client:
        yield client


@pytest.fixture
async def test_project(db):
    """Create a test project with cleanup."""
    project = await create_project("E2E Test Project", "Full system test")
    yield project

    # Cleanup
    await delete_project(project.id)
    project_dir = PROJECTS_ROOT / project.id
    if project_dir.exists():
        shutil.rmtree(project_dir)
```

### 6. End-to-End Tests (server/tests/test_e2e.py)

```python
"""End-to-end integration tests.

Run with: pytest server/tests/test_e2e.py -v

Ensure the server is running: uvicorn server.main:app --reload
"""

import pytest
import httpx

from files.storage import create_file
from conversations.writer import create_conversation


@pytest.mark.asyncio
class TestE2EIntegration:
    """End-to-end tests for the full system."""

    async def test_project_creation(self, client: httpx.AsyncClient):
        """Test creating a project via API."""
        response = await client.post(
            "/api/projects",
            json={"name": "API Test Project"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == "API Test Project"

        # Cleanup
        await client.delete(f"/api/projects/{data['id']}")

    async def test_file_upload_and_list(
        self,
        client: httpx.AsyncClient,
        test_project
    ):
        """Test file upload and listing."""
        # Upload file via internal function (or use API)
        await create_file(
            test_project.id,
            "test.txt",
            "Hello, World!",
            "text/plain"
        )

        # List files via API
        response = await client.get(
            f"/api/projects/{test_project.id}/files"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["files"]) >= 1
        assert any(f["path"] == "test.txt" for f in data["files"])

    async def test_conversation_creation(
        self,
        client: httpx.AsyncClient,
        test_project
    ):
        """Test conversation creation and retrieval."""
        # Create conversation
        response = await client.post(
            "/api/conversations",
            json={
                "projectId": test_project.id,
                "title": "Test Conversation"
            }
        )
        assert response.status_code == 200
        data = response.json()
        conv_id = data["id"]

        # Retrieve conversation
        response = await client.get(
            f"/api/conversations/{conv_id}?includeContent=true"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["conversation"]["title"] == "Test Conversation"

    async def test_full_turn_workflow(
        self,
        client: httpx.AsyncClient,
        test_project
    ):
        """Test complete message turn with model response."""
        # Create test data file
        await create_file(
            test_project.id,
            "sales.csv",
            "month,sales\nJan,1000\nFeb,1200\nMar,1500",
            "text/csv"
        )

        # Create conversation
        conv = await create_conversation(
            test_project.id,
            "Sales Analysis Test"
        )

        # Send message asking to analyze data
        response = await client.post(
            "/api/turn",
            json={
                "projectId": test_project.id,
                "conversationId": conv.id,
                "userMessage": "Read sales.csv and tell me the total sales",
                "targetModels": [
                    {"provider": "openai", "modelId": "gpt-4o-mini"}
                ],
                "roundNumber": 1
            },
            timeout=120.0  # Model calls can be slow
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["responses"]) == 1

        model_response = data["responses"][0]
        assert "response" in model_response
        assert model_response["response"]  # Non-empty

        # Verify model analyzed the file (look for total: 3700)
        resp_text = model_response["response"].lower()
        assert any(
            term in resp_text
            for term in ["3700", "sales", "total", "sum"]
        ), "Model should have read and analyzed the CSV"

    async def test_multi_round_conversation(
        self,
        client: httpx.AsyncClient,
        test_project
    ):
        """Test multi-round conversation with context."""
        # Create conversation
        conv = await create_conversation(
            test_project.id,
            "Multi-round Test"
        )

        # Round 1
        response1 = await client.post(
            "/api/turn",
            json={
                "projectId": test_project.id,
                "conversationId": conv.id,
                "userMessage": "Remember this number: 42",
                "targetModels": [
                    {"provider": "openai", "modelId": "gpt-4o-mini"}
                ],
                "roundNumber": 1
            },
            timeout=60.0
        )
        assert response1.status_code == 200

        # Round 2 - verify context is maintained
        response2 = await client.post(
            "/api/turn",
            json={
                "projectId": test_project.id,
                "conversationId": conv.id,
                "userMessage": "What number did I ask you to remember?",
                "targetModels": [
                    {"provider": "openai", "modelId": "gpt-4o-mini"}
                ],
                "roundNumber": 2
            },
            timeout=60.0
        )
        assert response2.status_code == 200
        data = response2.json()

        # Model should remember the number
        assert "42" in data["responses"][0]["response"]

        # Verify conversation was saved with all messages
        conv_response = await client.get(
            f"/api/conversations/{conv.id}?includeContent=true"
        )
        assert conv_response.status_code == 200
        conv_data = conv_response.json()
        # 2 user messages + 2 agent responses = 4 messages
        assert len(conv_data["conversation"]["messages"]) >= 4

    async def test_search_functionality(
        self,
        client: httpx.AsyncClient,
        test_project
    ):
        """Test search across files and conversations."""
        # Create searchable content
        await create_file(
            test_project.id,
            "notes.txt",
            "Important meeting notes about the quarterly review.",
            "text/plain"
        )

        # Allow time for indexing (in real tests, would wait for index)
        import asyncio
        await asyncio.sleep(1)

        # Search for content
        response = await client.post(
            f"/api/projects/{test_project.id}/search",
            json={"query": "quarterly review", "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()

        # Should find the file
        assert len(data["results"]) >= 1
        assert any(
            r.get("file_path") == "notes.txt"
            for r in data["results"]
        )

    async def test_multiple_models(
        self,
        client: httpx.AsyncClient,
        test_project
    ):
        """Test sending to multiple models simultaneously."""
        conv = await create_conversation(
            test_project.id,
            "Multi-model Test"
        )

        response = await client.post(
            "/api/turn",
            json={
                "projectId": test_project.id,
                "conversationId": conv.id,
                "userMessage": "Say hello in exactly 3 words.",
                "targetModels": [
                    {"provider": "openai", "modelId": "gpt-4o-mini"},
                    {"provider": "anthropic", "modelId": "claude-sonnet-4-5"}
                ],
                "roundNumber": 1
            },
            timeout=120.0
        )
        assert response.status_code == 200
        data = response.json()

        # Should have responses from both models
        assert len(data["responses"]) == 2
        for resp in data["responses"]:
            assert "response" in resp
            assert resp["response"]  # Non-empty


# Run specific tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
```

### 7. Python Dependencies (pyproject.toml)

```toml
[project]
name = "multimodelchat"
version = "1.0.0"
requires-python = ">=3.12"

dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "asyncpg>=0.30",
    "aiofiles>=24.1",
    "httpx>=0.28",
    "openai>=1.55",
    "anthropic>=0.39",
    "python-multipart>=0.0.12",
    "pyyaml>=6.0",
    "pydantic>=2.10",
    "sentence-transformers>=3.3",
    "watchdog>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
]

[project.scripts]
serve = "uvicorn server.main:app --reload"
index = "python -m indexer.main"
```

**Note:** Use minimum version constraints (e.g., `>=0.115`) to get latest compatible versions. Run `pip install -e .` or `pip install -e .[dev]` for development.

## Running

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e .[dev]

# Set up environment
cp .env.example .env
# Edit .env with your API keys and database URL

# Initialize database (see spec 01)
python -m server.db.migrations

# Start server
uvicorn server.main:app --reload

# In another terminal: Start indexer
python -m indexer.main

# In another terminal: Run e2e tests
pytest server/tests/test_e2e.py -v
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
→ Make sure static files are served from same origin as API, or configure CORS in FastAPI

**"Model not responding"**
→ Check API keys in .env file; ensure they're loaded with python-dotenv

**"Search not working"**
→ Ensure indexer daemon is running and files are being indexed (check Step 06)

**"UI not updating"**
→ Check browser console for JavaScript errors

**"Database connection failed"**
→ Verify DATABASE_URL in .env and ensure Postgres is running

**"pytest not finding tests"**
→ Ensure pytest-asyncio is installed and tests use @pytest.mark.asyncio decorator

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
- Installation instructions (Python 3.12+, venv, pip)
- Postgres and pgvector setup
- API key setup
- Usage examples
- Architecture overview
- Development guide

---

**Previous:** [07-system-prompts.md](07-system-prompts.md) | **Next:** [09-context-management.md](09-context-management.md)

---

## 🎉 Congratulations!

You've completed all 8 core steps! You now have a fully functional multi-model chat system with:

✅ Postgres persistence with pgvector
✅ Filesystem storage with aiofiles
✅ Bubblewrap sandbox execution
✅ Tool calling (bash)
✅ Unified search (full-text + semantic with Qwen3-Embedding-0.6B)
✅ Rich system prompts
✅ Web UI
✅ Indexer daemon with watchdog file watching
✅ pytest-based test suite

**Next steps:**
- Continue to Step 09 for context management and token optimization
- Polish the UI
- Add more model providers (Google, etc.)
- Deploy to Linux server (Fedora recommended)
