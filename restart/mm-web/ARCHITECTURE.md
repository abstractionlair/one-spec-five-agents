# Architecture: mm-web

## Overview

mm-web is a vanilla JavaScript frontend that consumes the mm-server REST API.

```
┌─────────────────────────────────────────────────────────────┐
│                          Browser                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                      mm-web                          │   │
│  │                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │   │
│  │  │ Project List │  │ Conversation │  │   Files   │ │   │
│  │  └──────────────┘  └──────────────┘  └───────────┘ │   │
│  │          │                │                │        │   │
│  │          └────────────────┴────────────────┘        │   │
│  │                           │                          │   │
│  │                    ┌──────┴──────┐                  │   │
│  │                    │   api.js    │                  │   │
│  │                    └──────┬──────┘                  │   │
│  └───────────────────────────┼──────────────────────────┘   │
│                              │                               │
└──────────────────────────────┼───────────────────────────────┘
                               │ HTTP (fetch)
                               ▼
                        ┌─────────────┐
                        │  mm-server  │
                        │  (port 3000)│
                        └─────────────┘
```

## Components

### API Client (src/api.js)

Wrapper around mm-server's REST API.

```javascript
// src/api.js
const API_URL = import.meta.env.VITE_API_URL || '';

export async function listProjects() {
  const res = await fetch(`${API_URL}/api/projects`);
  return res.json();
}

export async function sendTurn(projectId, conversationId, message, models) {
  const res = await fetch(`${API_URL}/api/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      conversation_id: conversationId,
      user_message: message,
      target_models: models
    })
  });
  return res.json();
}

// ... other API methods
```

### Project List (src/components/project-list.js)

Sidebar showing projects.

```javascript
// Renders list of projects
// Handles project selection
// Triggers conversation loading
```

### Conversation (src/components/conversation.js)

Main chat interface.

```javascript
// Message history display
// Input field for user messages
// Model response rendering
// Tool call display
```

### Model Selector (src/components/model-selector.js)

Checkboxes for selecting which models to query.

```javascript
// Available models list
// Selection state
// Provider grouping (OpenAI, Anthropic)
```

### File Browser (src/components/file-browser.js)

Project files view.

```javascript
// File listing
// Upload functionality
// File preview (text files)
```

### Message Display (src/components/message.js)

Single message rendering.

```javascript
// Markdown parsing (marked.js)
// Code block highlighting
// Speaker identification (user vs models)
// Tool call results
```

## File Structure

```
mm-web/
  index.html              # Entry HTML
  src/
    main.js               # App initialization
    api.js                # API client
    components/
      project-list.js
      conversation.js
      model-selector.js
      file-browser.js
      message.js
    utils/
      markdown.js         # Markdown rendering
      format.js           # Date/time formatting
  styles/
    main.css              # All styles
  package.json
```

## State Management

Minimal state, stored in simple variables:

```javascript
// Current state
let currentProject = null;
let currentConversation = null;
let selectedModels = [];
let messages = [];
```

No Redux, no complex state machines. State changes trigger re-renders of affected components.

## Data Flow

### Loading Conversation

```
User clicks conversation
       │
       ▼
api.getConversation(id)
       │
       ▼
Store messages in state
       │
       ▼
Render message list
```

### Sending Message

```
User types message, clicks send
       │
       ▼
api.sendTurn(project, conv, message, models)
       │
       ▼
Append user message to UI (optimistic)
       │
       ▼
Wait for response...
       │
       ▼
Append model responses to UI
```

## Markdown Rendering

Using marked.js with custom renderers:

```javascript
import { marked } from 'marked';

marked.setOptions({
  highlight: function(code, lang) {
    // Syntax highlighting
  },
  gfm: true,
  breaks: true
});

function renderMessage(content) {
  return marked.parse(content);
}
```

## Styling

CSS custom properties for theming:

```css
:root {
  --bg-primary: #1a1a1a;
  --text-primary: #ffffff;
  --model-openai: #10a37f;
  --model-anthropic: #d97706;
}

/* Model-specific colors */
.message[data-provider="openai"] { border-left-color: var(--model-openai); }
.message[data-provider="anthropic"] { border-left-color: var(--model-anthropic); }
```

## Build & Development

### Development

```bash
npm run dev
# Starts Vite dev server on http://localhost:5173
# Proxies /api/* to http://localhost:3000
```

### Production Build

```bash
npm run build
# Output to dist/
# Static files ready for nginx
```

### Deployment

**Option 1: nginx**
```nginx
server {
    listen 80;
    root /opt/mm/mm-web/dist;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

**Option 2: mm-server serves static files**
```python
# In mm-server/src/main.py
app.mount("/", StaticFiles(directory="../mm-web/dist", html=True))
```

## External Dependencies

| Dependency | Purpose |
|------------|---------|
| marked | Markdown → HTML |
| (vite) | Dev server & build (optional) |

## For System Context

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for:
- How mm-web fits in the three-project architecture
- Deployment configuration
- nginx setup
