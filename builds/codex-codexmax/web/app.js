let currentProject = null;
let currentConversation = null;
let currentRound = 1;

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
  currentConversation = null;
  await loadConversations();
  await loadFiles();
  document.getElementById('messages').innerHTML = '';
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
    div.addEventListener('click', (evt) => selectConversation(conv.id, evt));
    list.appendChild(div);
  }
}

async function createConversation() {
  if (!currentProject) {
    alert('Select a project first');
    return;
  }

  const title = prompt('Conversation title:');

  await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: currentProject,
      title
    })
  });

  await loadConversations();
}

async function selectConversation(convId, evt) {
  currentConversation = convId;
  currentRound = 1;

  document.querySelectorAll('.conv-item').forEach((el) => el.classList.remove('active'));
  if (evt && evt.target) {
    evt.target.classList.add('active');
  }

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

  const checkboxes = document.querySelectorAll('.model-checkbox:checked');
  const targetModels = Array.from(checkboxes).map((cb) => {
    const [provider, modelId] = cb.value.split('|');
    return { provider, modelId };
  });

  if (targetModels.length === 0) {
    alert('Select at least one model');
    return;
  }

  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  input.value = '';

  addMessageToUI('user', 'You', message);

  const loadingMessages = targetModels.map((model) => {
    return addMessageToUI('loading', model.modelId, 'Thinking...', null, true);
  });

  try {
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

    loadingMessages.forEach((msg) => msg.remove());

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
    loadingMessages.forEach((msg) => msg.remove());
    addMessageToUI('error', 'System', `Failed to send message: ${err.message}`, null);
  } finally {
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

  if (usage) {
    const usageDiv = document.createElement('div');
    usageDiv.className = 'message-usage';
    usageDiv.textContent = `Tokens: ${usage.input_tokens || 0} in, ${usage.output_tokens || 0} out`;
    div.appendChild(usageDiv);
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  return div;
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
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

init();
