# mm-web

Frontend UI for the Multi-Model Chat system. Vanilla JavaScript application that consumes the mm-server REST API.

## Quick Start

```bash
# Install dependencies
cd mm-web
npm install

# Start development server
npm run dev
# Open http://localhost:5173

# Build for production
npm run build
# Output in dist/
```

## Features

- Project management (create, list, select)
- Conversation interface (chat UI)
- Model selection (checkboxes for parallel queries)
- File browser (upload, view project files)
- Markdown rendering (model responses)
- Search interface (full-text + semantic)

## Architecture

```
mm-web/
  src/
    main.js              # Entry point
    api.js               # mm-server API client
    components/
      project-list.js    # Project sidebar
      conversation.js    # Chat interface
      model-selector.js  # Model checkboxes
      file-browser.js    # Project files view
      message.js         # Message display
    utils/
      markdown.js        # Markdown → HTML
      format.js          # Formatting utilities
  styles/
    main.css
  index.html
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## API Dependency

Consumes mm-server's REST API. See [../mm-server/openapi.yaml](../mm-server/openapi.yaml).

Key endpoints used:
- `GET /api/projects` - List projects
- `POST /api/turn` - Send message, get responses
- `GET /api/projects/{id}/files` - List files

## Configuration

Development uses environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| VITE_API_URL | mm-server URL | http://localhost:3000 |

Production: API is proxied by nginx at same origin.

## Testing

```bash
npm test
```

## Deployment

Static files served by:
- **nginx (production):** Serves `dist/`, proxies `/api/*` to mm-server
- **mm-server (development):** Can serve static files directly

See parent [ARCHITECTURE.md](../ARCHITECTURE.md) for nginx configuration.

## Design Principles

### 1. Thin Client

All business logic in mm-server. Frontend is view layer only:
- Fetch data via API
- Render responses
- Send user input

### 2. No Framework

Vanilla JavaScript:
- Faster load times
- No build complexity
- Easy to understand
- marked.js for markdown rendering

### 3. Progressive Enhancement

Core functionality works without complex state management:
- Semantic HTML
- CSS for layout/styling
- JavaScript for interactivity

## Related

- [mm-server](../mm-server/) - Backend API (this calls it)
- [mm-search](../mm-search/) - Search service (called via mm-server)
- [Parent project](../) - Full system overview
