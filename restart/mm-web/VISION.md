# Vision: mm-web

## Purpose

Frontend UI that provides a user-friendly interface for multi-model conversations.

## Scope

This project **handles**:
- Project listing and creation
- Conversation UI (message input, response display)
- Model selection (checkboxes for parallel queries)
- File browser (view/upload project files)
- Markdown rendering (code blocks, formatting)
- Search interface

This project **does NOT handle**:
- Business logic (all in mm-server)
- Direct database access
- Model API calls
- File storage

## Design Principles

### 1. Thin Client

The frontend is a **view layer**. All logic lives in mm-server:
- No local state beyond UI state
- No caching (server is source of truth)
- API calls for all operations

Benefits:
- Simple mental model
- Easy to test (mock API responses)
- Server can enforce business rules

### 2. No Framework

Vanilla JavaScript with minimal dependencies:
- **marked.js** - Markdown rendering
- No React, Vue, Angular, etc.

Rationale:
- Faster initial load
- No build tooling complexity
- Easier for AI assistants to understand
- Smaller attack surface

### 3. Readable Output

Focus on displaying model responses well:
- Syntax highlighting for code blocks
- Collapsible sections for long responses
- Clear visual distinction between models (colors)
- Copy buttons for code snippets

## Success Criteria

- Page load < 1 second
- Smooth conversation flow
- Model responses render correctly (markdown, code)
- Works on desktop browsers (Chrome, Firefox, Safari)

## Non-Goals

- Mobile optimization
- Offline support
- Real-time collaboration
- Complex state management

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Language | Vanilla JavaScript | Simple, no build step required |
| Markdown | marked.js | Fast, widely used |
| Build | Vite (optional) | Fast dev server, minimal config |
| Styling | CSS (no framework) | Full control, no bloat |

## Relationship to System

mm-web consumes mm-server's API:

```
User → Browser → mm-web → HTTP → mm-server
```

The frontend only communicates with mm-server. It never calls mm-search directly.

For full system context, see [../VISION.md](../VISION.md).
