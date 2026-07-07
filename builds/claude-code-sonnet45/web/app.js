// State
let currentProject = null;
let currentConversation = null;

// API Base URL
const API_BASE = window.location.origin + '/api';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('projectSelect').addEventListener('change', handleProjectChange);
  document.getElementById('newProjectBtn').addEventListener('click', createNewProject);
  document.getElementById('newConversationBtn').addEventListener('click', createNewConversation);
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      sendMessage();
    }
  });
}

// Projects
async function loadProjects() {
  try {
    const res = await fetch(`${API_BASE}/projects`);
    const data = await res.json();

    // For now, create a default project if none exist
    if (!data.projects || data.projects.length === 0) {
      await createDefaultProject();
      return;
    }

    const select = document.getElementById('projectSelect');
    select.innerHTML = '<option value="">Select Project...</option>';

    data.projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });

    // Auto-select first project
    if (data.projects.length > 0) {
      select.value = data.projects[0].id;
      handleProjectChange();
    }
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

async function createDefaultProject() {
  try {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Default Project',
        description: 'My first multi-model chat project'
      })
    });
    const data = await res.json();
    currentProject = data.project.id;
    loadProjects();
  } catch (err) {
    console.error('Failed to create default project:', err);
  }
}

async function createNewProject() {
  const name = prompt('Enter project name:');
  if (!name) return;

  try {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    loadProjects();
    document.getElementById('projectSelect').value = data.project.id;
    handleProjectChange();
  } catch (err) {
    console.error('Failed to create project:', err);
    alert('Failed to create project');
  }
}

function handleProjectChange() {
  const select = document.getElementById('projectSelect');
  currentProject = select.value;

  if (currentProject) {
    loadConversations();
  }
}

// Conversations
async function loadConversations() {
  if (!currentProject) return;

  try {
    const res = await fetch(`${API_BASE}/conversations?projectId=${currentProject}`);
    const data = await res.json();

    const list = document.getElementById('conversationList');
    list.innerHTML = '';

    if (data.conversations && data.conversations.length > 0) {
      data.conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        item.textContent = conv.title || `Conversation ${conv.id.slice(-8)}`;
        item.onclick = () => loadConversation(conv.id);
        list.appendChild(item);
      });
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

async function createNewConversation() {
  if (!currentProject) {
    alert('Please select a project first');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: currentProject,
        title: 'New Conversation'
      })
    });
    const data = await res.json();
    currentConversation = data.conversation.id;
    loadConversations();
    clearMessages();
  } catch (err) {
    console.error('Failed to create conversation:', err);
    alert('Failed to create conversation');
  }
}

async function loadConversation(conversationId) {
  currentConversation = conversationId;

  // Update UI
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.classList.remove('active');
  });
  event.target.classList.add('active');

  try {
    const res = await fetch(`${API_BASE}/conversations/${conversationId}?includeContent=true`);
    const data = await res.json();

    displayMessages(data.conversation.messages);
  } catch (err) {
    console.error('Failed to load conversation:', err);
  }
}

function displayMessages(messages) {
  const container = document.getElementById('messages');
  container.innerHTML = '';

  messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `message ${msg.speaker === 'user' ? 'user' : 'agent'}`;

    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = msg.speaker === 'user' ? 'You' : msg.speaker;

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.content;

    div.appendChild(header);
    div.appendChild(content);
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

function clearMessages() {
  document.getElementById('messages').innerHTML = '';
}

// Send message
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();

  if (!message) return;

  if (!currentProject) {
    alert('Please select a project first');
    return;
  }

  // Get selected models
  const checkboxes = document.querySelectorAll('.model-checkbox:checked');
  if (checkboxes.length === 0) {
    alert('Please select at least one model');
    return;
  }

  const targetModels = Array.from(checkboxes).map(cb => {
    const [provider, modelId] = cb.value.split(':');
    return { provider, modelId };
  });

  // Add user message to UI
  addMessage('user', 'You', message);
  input.value = '';

  // Show loading
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  loadingDiv.textContent = 'Models are thinking...';
  document.getElementById('messages').appendChild(loadingDiv);

  try {
    const res = await fetch(`${API_BASE}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: currentProject,
        conversationId: currentConversation,
        userMessage: message,
        targetModels
      })
    });

    const data = await res.json();

    // Remove loading
    loadingDiv.remove();

    // Update current conversation if it was created
    if (data.conversationId && !currentConversation) {
      currentConversation = data.conversationId;
      loadConversations();
    }

    // Add responses
    data.responses.forEach(response => {
      if (response.error) {
        addMessage('agent', `${response.provider}:${response.modelId} (Error)`, response.error);
      } else {
        addMessage('agent', `${response.provider}:${response.modelId}`, response.response);
      }
    });
  } catch (err) {
    loadingDiv.remove();
    console.error('Failed to send message:', err);
    alert('Failed to send message: ' + err.message);
  }
}

function addMessage(type, speaker, content) {
  const container = document.getElementById('messages');

  const div = document.createElement('div');
  div.className = `message ${type}`;

  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = speaker;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;

  div.appendChild(header);
  div.appendChild(contentDiv);
  container.appendChild(div);

  container.scrollTop = container.scrollHeight;
}
