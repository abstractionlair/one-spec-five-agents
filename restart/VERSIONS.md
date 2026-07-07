# Current Stable Versions Reference

**Last Updated:** November 2025

This document lists the current stable versions of software and dependencies referenced in the project documentation. The specs use "latest stable version" language to avoid outdated version references - consult this file for current recommendations.

## System Software

| Component | Current Stable | Notes |
|-----------|---------------|-------|
| **Fedora** | 43 | **Target server OS for this project** |
| **Ubuntu LTS** | 24.04 "Noble Numbat" | Alternative if needed |
| **Python** | 3.14.x | Released Oct 2025 |
| **Node.js LTS** | 24.x "Krypton" | Entered LTS Oct 2025 |
| **PostgreSQL** | 17.x | With pgvector extension |

## Node.js Packages

| Package | Current Version | Purpose |
|---------|----------------|---------|
| **express** | 5.x | Web framework (v5 became default March 2025) |
| **pg** | 8.x | PostgreSQL client |
| **openai** | 6.x | OpenAI API SDK |
| **@anthropic-ai/sdk** | 0.70.x | Anthropic API SDK |
| **chokidar** | 4.x | File system watching (inotify wrapper) |
| **multer** | 1.x | File upload middleware |
| **axios** | 1.x | HTTP client (dev dependency) |

## AI Models

Model IDs change frequently. Check provider documentation for current recommended models.

### Supported Providers

| Provider | Status | Current Models (Nov 2025) |
|----------|--------|---------------------------|
| **OpenAI** | Implemented | gpt-5.1, gpt-5.1-mini, gpt-5.1-turbo |
| **Anthropic** | Implemented | claude-sonnet-4-5, claude-opus-4-5 |
| **Google Gemini** | Planned | gemini-3-pro |
| **xAI Grok** | Planned | grok-4, grok-4.1 |

### Future Providers to Consider

| Provider | Notes |
|----------|-------|
| **DeepSeek** | Strong reasoning models |
| **MiniMax** | |
| **Qwen** | Alibaba's models |
| **Z.ai** | |
| **Kimi** | Moonshot AI |
| **Mistral AI** | European provider |
| **Open-source** | Via Ollama/vLLM |

### Embedding Models

| Provider | Model | Dimensions |
|----------|-------|------------|
| **OpenAI** | text-embedding-3-small | 1536 |
| **OpenAI** | text-embedding-3-large | 3072 |

### Adding New Providers

The adapter architecture supports adding new providers. See ARCHITECTURE.md "Model Adapter Architecture" section for the extensibility pattern.

## Linux Tools

| Tool | Purpose | Install (Fedora) |
|------|---------|------------------|
| **bubblewrap** | Process sandboxing | `dnf install bubblewrap` |
| **chokidar** | File watching (via npm) | Part of Node.js deps |

## How to Update This File

When setting up a new environment or updating dependencies:

1. Check current LTS versions:
   - Node.js: https://nodejs.org/en/about/releases/
   - Python: https://www.python.org/downloads/
   - Ubuntu: https://ubuntu.com/about/release-cycle
   - PostgreSQL: https://www.postgresql.org/support/versioning/

2. Check npm package versions:
   ```bash
   npm view express version
   npm view openai version
   npm view @anthropic-ai/sdk version
   ```

3. Update this file with current versions.

## Version Policy

- **Specs use "latest stable"** - Don't hardcode versions in spec files
- **package.json uses major ranges** - e.g., `"express": "^5"` to get latest 5.x
- **This file documents current actuals** - Update when deploying

This separation ensures:
- Specs don't become outdated
- Dependencies stay reasonably current
- There's a single place to check recommended versions
