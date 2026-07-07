# Multi-Model Chat System

A project-aware AI orchestration system that queries multiple models (GPT-4, Claude, etc.) in parallel with shared context, persistent file storage, and sandboxed code execution.

## Features

- **Multi-Model Orchestration**: Query OpenAI and Anthropic models simultaneously.
- **Project Awareness**: AI models know about your project files and structure.
- **Sandboxed Execution**: Models can run bash commands, Python scripts, and Node.js code in Docker containers.
- **Persistent Storage**: Files and conversations are stored on disk and indexed in SQLite.
- **Unified Search**: Full-text search across project files and conversation history.
- **Web UI**: Simple interface for managing projects, files, and conversations.

## Prerequisites

- Node.js 18+
- Docker Desktop (running)
- API Keys for OpenAI and/or Anthropic

## Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd multi-model-chat-gemini
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Set up environment variables:
    ```bash
    cp .env.example .env
    ```
    Edit `.env` and add your API keys:
    ```
    OPENAI_API_KEY=sk-...
    ANTHROPIC_API_KEY=sk-ant-...
    ```

## Usage

1.  Start the server:
    ```bash
    npm start
    ```

2.  Open http://localhost:3000 in your browser.

3.  **Create a Project**: Click "New Project".
4.  **Upload Files**: Upload code or data files to your project.
5.  **Start Chatting**: Select models (e.g., GPT-4o Mini, Claude Sonnet) and ask questions.
    - Try: "Analyze the data.csv file"
    - Try: "Create a python script to calculate fibonacci"

## Development

- **Run Tests**: `npm test` (Runs end-to-end tests, requires Docker and API keys)
- **Project Structure**:
    - `server/`: Node.js backend
        - `db/`: Database schema and migrations
        - `files/`: File storage logic
        - `conversations/`: Conversation management
        - `execution/`: Docker execution environment
        - `indexing/`: Search indexing (FTS5)
        - `prompts/`: System prompt builders
        - `adapters/`: Model provider adapters
    - `web/`: Frontend (HTML/CSS/JS)
    - `projects/`: User data storage (gitignored)
    - `storage/`: SQLite database (gitignored)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.