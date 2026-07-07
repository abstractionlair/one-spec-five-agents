# Step 07: System Prompts & Context

**Goal:** Build rich system prompts with project context, file listings, and bash tool instructions.

**Complexity:** Low (2-3 hours)

**Dependencies:** Step 05 (Tool integration), Step 06 (Search)

## Overview

System prompts provide models with:
- Project information and file structure
- Instructions for using bash tool
- Environment setup guidance (venv, npm, pixi)
- Conversation context

## File Structure

```
server/
  prompts/
    __init__.py
    builder.py      # System prompt construction
    templates.py    # Prompt templates by provider
  tests/
    test_prompts.py # Test script
```

## Implementation

### 1. Prompt Templates (server/prompts/templates.py)

```python
"""System prompt templates by provider."""

from dataclasses import dataclass


@dataclass
class FileInfo:
    """File information for prompt context."""
    path: str
    size_bytes: int
    mime_type: str | None = None


@dataclass
class PromptContext:
    """Context for building system prompts."""
    project_name: str
    model_id: str
    file_list: list[FileInfo]
    round_number: int


def format_bytes(size_bytes: int) -> str:
    """Format bytes for display."""
    if size_bytes < 1024:
        return f"{size_bytes}B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    return f"{size_bytes / (1024 * 1024):.1f}MB"


def base_system_prompt(ctx: PromptContext) -> str:
    """
    Base system prompt (provider-agnostic).
    """
    # Format file list
    files_shown = ctx.file_list[:20]
    file_lines = [f"- {f.path} ({format_bytes(f.size_bytes)})" for f in files_shown]
    files_text = "\n".join(file_lines)

    if len(ctx.file_list) > 20:
        files_text += f"\n... and {len(ctx.file_list) - 20} more files"

    # Round context
    round_context = f"This is round {ctx.round_number} of the conversation."
    if ctx.round_number > 1:
        round_context += " Previous messages are in the conversation history."

    return f'''You are {ctx.model_id} participating in a multi-model conversation about the "{ctx.project_name}" project.

## Project Context

You have access to the project directory via the bash tool. The project currently contains {len(ctx.file_list)} file(s):

{files_text}

## Bash Tool Usage

You have access to a bash tool that executes commands in a bubblewrap sandbox:

**Working Directory:** /project
**Persistent Storage:** Files you create persist between commands
**Network Access:** Enabled by default for installing packages and fetching data (can be disabled per project)

### Creating Python Environment

```bash
# Create virtual environment
python3 -m venv .venv

# Activate and install packages
source .venv/bin/activate && pip install pandas numpy matplotlib

# Run scripts
source .venv/bin/activate && python analyze.py
```

For specific Python versions, install pyenv in the project directory:

```bash
# Install pyenv to project
curl https://pyenv.run | PYENV_ROOT=$PWD/.pyenv bash

# Install specific Python version (use latest stable or as needed)
export PYENV_ROOT=$PWD/.pyenv && .pyenv/bin/pyenv install 3.12

# Create venv with specific version
.pyenv/versions/3.12.*/bin/python -m venv .venv
```
Prefer plain `python3 -m venv` with system Python unless you specifically need a different version.

### Node.js / npm

```bash
# Initialize package.json
npm init -y

# Install packages
npm install lodash axios

# Run scripts
node script.js
```

### Best Practices

- Install packages into project directory (.venv, node_modules)
- Environments persist across tool calls
- Check if files exist before creating them
- Use relative paths
- Handle errors gracefully

## Conversation Context

{round_context}
'''


def openai_system_prompt(ctx: PromptContext) -> str:
    """OpenAI-specific system prompt."""
    return base_system_prompt(ctx) + """

## Response Format

Provide clear, concise responses. Use the bash tool when you need to:
- Read or analyze files
- Create or modify code
- Install dependencies
- Run scripts or calculations

Be explicit about what you're doing and why."""


def anthropic_system_prompt(ctx: PromptContext) -> str:
    """Anthropic-specific system prompt."""
    return base_system_prompt(ctx) + """

## Response Guidelines

Use the bash tool proactively when it would help answer the user's question. For example:
- If asked about data, read and analyze it
- If asked to create something, build it
- If code needs testing, run it

Explain your reasoning and show your work."""
```

### 2. Prompt Builder (server/prompts/builder.py)

```python
"""System prompt construction and message building."""

from dataclasses import dataclass
from typing import Any

from db import get_pool
from prompts.templates import (
    PromptContext,
    FileInfo,
    openai_system_prompt,
    anthropic_system_prompt
)
from conversations.reader import get_conversation_with_messages


MAX_HISTORY_MESSAGES = 10


@dataclass
class BuiltMessages:
    """Result of building messages for a model."""
    system: str | None
    messages: list[dict[str, str]]


async def build_system_prompt(
    provider: str,
    model_id: str,
    project_id: str,
    round_number: int
) -> str:
    """
    Build system prompt for a model.

    Args:
        provider: Model provider ('openai', 'anthropic', etc.)
        model_id: Model identifier
        project_id: Project ID
        round_number: Current conversation round

    Returns:
        System prompt string
    """
    pool = await get_pool()

    # Get project info
    project = await pool.fetchrow(
        "SELECT * FROM projects WHERE id = $1",
        project_id
    )
    if not project:
        raise ValueError(f"Project not found: {project_id}")

    # Get file list
    files = await pool.fetch("""
        SELECT path, size_bytes, mime_type
        FROM project_files
        WHERE project_id = $1
        ORDER BY path
    """, project_id)

    # Build context
    file_list = [
        FileInfo(
            path=f["path"],
            size_bytes=f["size_bytes"],
            mime_type=f["mime_type"]
        )
        for f in files
    ]

    ctx = PromptContext(
        project_name=project["name"],
        model_id=model_id,
        file_list=file_list,
        round_number=round_number
    )

    # Choose template based on provider
    if provider == "openai":
        return openai_system_prompt(ctx)
    elif provider == "anthropic":
        return anthropic_system_prompt(ctx)
    else:
        # Default for unknown providers
        return openai_system_prompt(ctx)


```

**Note:** The `build_messages` function that constructs per-model conversation views (with roundtable tagged blocks) is defined in [Step 05b](05b-message-building.md). This step only adds `build_system_prompt` which `build_messages` calls to get the system prompt content.

The roundtable pattern (where each model sees other models' responses as `[ModelName]: ...` tags) is critical to the multi-model conversation design. See ARCHITECTURE.md "Per-Model View Building" for details.

### 3. Update /api/turn (server/main.py)

Replace the hardcoded message building with the prompt builder:

```python
from prompts.builder import build_messages

@app.post("/api/turn", response_model=TurnResponse)
async def turn(request: TurnRequest) -> TurnResponse:
    """Send message to multiple models, get responses."""
    # ... validation ...

    # Save user message
    await save_message(
        conversation_id=conversation_id,
        round_number=effective_round,
        role="user",
        content=request.user_message,
        metadata={}
    )

    async def query_model(target: TargetModel) -> ModelResponse:
        try:
            # Build messages with context
            built = await build_messages(
                conversation_id=conversation_id,
                provider=target.provider,
                model_id=target.model_id,
                round_number=effective_round
            )

            # Tool call handler
            async def on_tool_call(tool_name: str, args: dict) -> dict:
                result = await execute_tool(
                    tool_name=tool_name,
                    args=args,
                    project_id=request.project_id,
                    timeout=60,
                    network=True
                )
                return asdict(result)

            # Call appropriate adapter
            if target.provider == "openai":
                # built.messages includes system message
                result = await send_openai(
                    model=target.model_id,
                    messages=[Message(role=m["role"], content=m["content"]) for m in built.messages],
                    tools=[BASH_TOOL],
                    on_tool_call=on_tool_call
                )
            elif target.provider == "anthropic":
                # built.system is separate
                result = await send_anthropic(
                    model=target.model_id,
                    messages=[Message(role=m["role"], content=m["content"]) for m in built.messages],
                    system=built.system,
                    tools=[BASH_TOOL],
                    on_tool_call=on_tool_call
                )
            else:
                raise ValueError(f"Unknown provider: {target.provider}")

            # Save response
            await save_message(
                conversation_id=conversation_id,
                round_number=effective_round,
                role=f"agent:{target.model_id}",
                content=result.text,
                metadata={
                    "model": target.model_id,
                    "provider": target.provider,
                    "usage": result.usage
                }
            )

            return ModelResponse(
                provider=target.provider,
                model_id=target.model_id,
                response=result.text,
                usage=result.usage
            )

        except Exception as err:
            logger.error(f"Error querying {target.provider}/{target.model_id}: {err}")
            return ModelResponse(
                provider=target.provider,
                model_id=target.model_id,
                error=str(err)
            )

    # Run all model queries in parallel
    responses = await asyncio.gather(
        *[query_model(target) for target in request.target_models]
    )

    return TurnResponse(
        conversation_id=conversation_id,
        round_number=effective_round,
        responses=list(responses)
    )
```

### 4. Test Script (server/tests/test_prompts.py)

```python
"""Tests for system prompt building."""

import asyncio
import shutil
import sys
from pathlib import Path

# Add server to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from db import init_db, close_db
from db.projects import create_project, delete_project
from files.storage import create_file, PROJECTS_ROOT
from conversations.writer import create_conversation, save_message
from prompts.builder import build_system_prompt, build_messages


@pytest.fixture
async def test_project():
    """Create and cleanup test project."""
    await init_db()

    project = await create_project("Prompt Test", "Testing system prompts")
    yield project

    # Cleanup
    await delete_project(project.id)
    project_dir = PROJECTS_ROOT / project.id
    if project_dir.exists():
        shutil.rmtree(project_dir)

    await close_db()


@pytest.mark.asyncio
async def test_openai_system_prompt(test_project):
    """Test OpenAI system prompt generation."""
    await create_file(test_project.id, "test.py", b'print("hello")', "text/x-python")

    prompt = await build_system_prompt("openai", "gpt-4o", test_project.id, 1)

    assert "Prompt Test" in prompt
    assert "test.py" in prompt
    assert "bash" in prompt
    assert "venv" in prompt


@pytest.mark.asyncio
async def test_anthropic_system_prompt(test_project):
    """Test Anthropic system prompt generation."""
    await create_file(test_project.id, "test.py", b'print("hello")', "text/x-python")

    prompt = await build_system_prompt("anthropic", "claude-sonnet-4-5", test_project.id, 1)

    assert "Prompt Test" in prompt
    assert "proactively" in prompt  # Anthropic-specific language


@pytest.mark.asyncio
async def test_openai_messages(test_project):
    """Test OpenAI message building."""
    conv = await create_conversation(test_project.id, "Test")
    await save_message(conv.id, 1, "user", "Hello", {})

    built = await build_messages(
        conversation_id=conv.id,
        provider="openai",
        model_id="gpt-4o",
        round_number=1
    )

    assert built.system is None  # OpenAI puts system in messages
    assert isinstance(built.messages, list)
    assert built.messages[0]["role"] == "system"
    assert any(m["role"] == "user" for m in built.messages)


@pytest.mark.asyncio
async def test_anthropic_messages(test_project):
    """Test Anthropic message building."""
    conv = await create_conversation(test_project.id, "Test")
    await save_message(conv.id, 1, "user", "Hello", {})

    built = await build_messages(
        conversation_id=conv.id,
        provider="anthropic",
        model_id="claude-sonnet-4-5",
        round_number=1
    )

    assert built.system is not None  # Anthropic has separate system
    assert isinstance(built.messages, list)
    # Messages should not include system role
    assert not any(m["role"] == "system" for m in built.messages)


@pytest.mark.asyncio
async def test_file_list_truncation(test_project):
    """Test that file list truncates for many files."""
    # Add many files
    for i in range(25):
        await create_file(test_project.id, f"file{i}.txt", f"content {i}".encode(), "text/plain")

    prompt = await build_system_prompt("openai", "gpt-4o", test_project.id, 1)

    assert "... and" in prompt


async def run_tests():
    """Run all prompt tests (standalone script mode)."""
    print("=== Testing System Prompts ===\n")

    test_project = None

    try:
        await init_db()

        # Create test project
        print("1. Creating test project...")
        test_project = await create_project("Prompt Test", "Testing system prompts")
        print(f"   Created project {test_project.id}\n")

        # Add some files
        print("2. Adding test files...")
        await create_file(test_project.id, "test.py", b'print("hello")', "text/x-python")
        await create_file(test_project.id, "data.csv", b"a,b\n1,2", "text/csv")
        print("   Added files\n")

        # Create conversation
        print("3. Creating conversation...")
        conv = await create_conversation(test_project.id, "Test")
        print(f"   Created conversation {conv.id}\n")

        # Build OpenAI system prompt
        print("4. Building OpenAI system prompt...")
        openai_prompt = await build_system_prompt("openai", "gpt-4o", test_project.id, 1)

        if "Prompt Test" not in openai_prompt:
            raise RuntimeError("Prompt missing project name")
        if "test.py" not in openai_prompt:
            raise RuntimeError("Prompt missing file listing")
        if "bash" not in openai_prompt:
            raise RuntimeError("Prompt missing bash instructions")
        if "venv" not in openai_prompt:
            raise RuntimeError("Prompt missing venv instructions")
        print("   OpenAI prompt contains all required elements\n")

        # Build Anthropic system prompt
        print("5. Building Anthropic system prompt...")
        anthropic_prompt = await build_system_prompt("anthropic", "claude-sonnet-4-5", test_project.id, 1)

        if "Prompt Test" not in anthropic_prompt:
            raise RuntimeError("Prompt missing project name")
        print("   Anthropic prompt contains required elements\n")

        # Build messages for OpenAI
        print("6. Building OpenAI messages...")
        await save_message(conv.id, 1, "user", "Hello", {})

        openai_built = await build_messages(
            conversation_id=conv.id,
            provider="openai",
            model_id="gpt-4o",
            round_number=1
        )

        if not isinstance(openai_built.messages, list):
            raise RuntimeError("OpenAI messages should be array")
        if openai_built.messages[0]["role"] != "system":
            raise RuntimeError("First OpenAI message should be system")
        if not any(m["role"] == "user" for m in openai_built.messages):
            raise RuntimeError("OpenAI messages should include user history")
        print("   OpenAI messages structured correctly with history\n")

        # Build messages for Anthropic
        print("7. Building Anthropic messages...")
        anthropic_built = await build_messages(
            conversation_id=conv.id,
            provider="anthropic",
            model_id="claude-sonnet-4-5",
            round_number=1
        )

        if not anthropic_built.system:
            raise RuntimeError("Anthropic builder should return system property")
        if not isinstance(anthropic_built.messages, list):
            raise RuntimeError("Anthropic messages should be array")
        print("   Anthropic messages structured correctly with history\n")

        # Test file count display
        print("8. Testing file count display...")
        for i in range(25):
            await create_file(test_project.id, f"file{i}.txt", f"content {i}".encode(), "text/plain")

        many_files_prompt = await build_system_prompt("openai", "gpt-4o", test_project.id, 1)
        if "... and" not in many_files_prompt:
            raise RuntimeError("Should truncate file list for many files")
        print("   File list truncates for many files\n")

        print("✓ All system prompt tests passed!")

    except Exception as err:
        print(f"\n✗ Test failed: {err}")
        sys.exit(1)
    finally:
        if test_project:
            await delete_project(test_project.id)
            project_dir = PROJECTS_ROOT / test_project.id
            if project_dir.exists():
                shutil.rmtree(project_dir)
        await close_db()


if __name__ == "__main__":
    asyncio.run(run_tests())
```

## Running

```bash
# Run prompt tests with pytest
pytest server/tests/test_prompts.py -v

# Or run standalone test script
python -m server.tests.test_prompts
```

## Success Criteria

- [ ] System prompt includes project name
- [ ] System prompt includes file listing
- [ ] System prompt includes bash tool instructions
- [ ] System prompt includes venv/npm/pixi examples
- [ ] OpenAI messages have system message in array
- [ ] Anthropic messages have separate system parameter
- [ ] File list truncates for many files (shows first 20)
- [ ] Test script passes

## Enhancements (Optional)

Consider adding in the future:
- **Search integration** - Include relevant search results in context
- **Conversation summary** - Summarize previous rounds
- **Cost tracking** - Warn if context getting large
- **Custom instructions** - Per-project customization

## Next Steps

After this step completes:
- **Step 08:** Create web UI for user interaction

---

**Previous:** [06-unified-search.md](06-unified-search.md) | **Next:** [08-ui-and-testing.md](08-ui-and-testing.md)
