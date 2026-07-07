# mm-web

Frontend UI: project management, conversation interface, and response display.

## Scope

This is the **frontend application**. It handles:
- Project listing and creation
- Conversation UI (message input, response display)
- Model selection (checkboxes for parallel queries)
- File browser (project files)
- Markdown rendering

It does **NOT** handle:
- API calls to model providers (that's mm-server)
- Search or embeddings (that's mm-search)
- File storage or database access (calls mm-server)

## API Dependency

Consumes mm-server's REST API defined in `../mm-server/openapi.yaml`.

Key endpoints used:
```
GET  /api/projects              → List projects
POST /api/projects              → Create project
GET  /api/projects/{id}/files   → List project files
POST /api/turn                  → Send message, get responses
GET  /api/projects/{id}/conversations
```

## File Structure

```
mm-web/
  package.json
  index.html
  src/
    main.js              # Entry point
    api.js               # mm-server API client
    components/
      project-list.js    # Project sidebar
      conversation.js    # Chat interface
      model-selector.js  # Model checkboxes
      file-browser.js    # Project files view
      message.js         # Single message display
    utils/
      markdown.js        # Markdown → HTML
      format.js          # Date/time formatting
  styles/
    main.css
  tests/
```

## Technology

- Vanilla JavaScript (no framework)
- Native fetch for API calls
- CSS custom properties for theming
- Marked.js for markdown rendering

## Development

```bash
cd mm-web
npm install
npm run dev    # Local dev server with hot reload
```

## Building

```bash
cd mm-web
npm run build  # Output to dist/
```

## Deployment

Static files served by:
- nginx (production) — serves `dist/` and proxies `/api/*` to mm-server
- mm-server (development) — can serve static files directly

See ARCHITECTURE.md in parent directory for nginx configuration.

## Design Principles

**1. Thin Client**

All business logic lives in mm-server. The frontend is a view layer:
- Fetches data via API
- Renders responses
- Sends user input

No local state beyond UI state (selected project, expanded panels).

**2. Progressive Enhancement**

Core functionality works without JavaScript frameworks:
- Semantic HTML
- CSS for layout
- JavaScript for interactivity

**3. Readable Output**

Markdown rendering with:
- Syntax highlighting for code blocks
- Collapsible sections for long responses
- Clear visual distinction between models (color-coded)

## Environment Variables

```
API_URL=http://localhost:3000   # mm-server URL (dev only, proxied in prod)
```
