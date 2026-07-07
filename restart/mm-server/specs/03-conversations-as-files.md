# Step 03: Conversations as Markdown Files

**Goal:** Store conversation messages as markdown files with YAML frontmatter, track metadata in database.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 01 (Database schema)

## Overview

Conversations are stored as markdown files in `.metadata/.conversations/` directories:
- Each conversation gets its own directory
- Messages stored as individual `.md` files with frontmatter
- Database tracks metadata for fast queries
- Files are the source of truth for content

## Many-to-Many Round Structure

This system supports **many-to-many conversations** where multiple models respond to each user message. The key concept is the **round**:

**One round consists of:**
1. One user message
2. Zero or more agent responses (typically from multiple models)

**Example: Round 1 with three models:**
```
001-user.md           → User: "Explain recursion"
001-agent-gpt-4o.md   → GPT-4o's response
001-agent-claude.md   → Claude's response
001-agent-gemini.md   → Gemini's response
```

**All agents in a round share the same round number.** This enables:
- Querying all responses for a given round
- Building per-model views of the conversation (see ARCHITECTURE.md)
- Tracking which models participated in which rounds

**When building prompts for round N+1**, each model sees:
- All user messages from rounds 1 to N
- **Other models' responses** tagged as `[ModelName]: ...`
- **Its own prior responses** as the `assistant` role (not tagged)

This creates the "roundtable" dynamic where models can build on each other's ideas.

## Directory Structure

```
/srv/projects/
  proj_abc123/
    workspace/            # User files (mounted in sandbox)
      ...
    .metadata/            # System metadata (not in sandbox)
      .conversations/
        conv_xyz789/
          rounds/
            001-user.md
            001-agent-gpt-4o.md
            001-agent-claude-sonnet-4-5.md
            002-user.md
            002-agent-gpt-4o.md
          metadata.json   # Optional: conversation-level metadata
```

## Message Format

```markdown
---
id: msg_abc123_def456
speaker: agent:gpt-4o
model: gpt-4o
provider: openai
round: 1
timestamp: 2025-01-22T10:30:00.000Z
usage:
  input_tokens: 1250
  output_tokens: 432
---

The authentication flow works by first checking the session cookie...
```

## File Structure

```
server/
  conversations/
    writer.py       # Save messages to markdown files
    reader.py       # Read and parse markdown files
    routes.py       # FastAPI routes for conversation APIs
  tests/
    test_conversations.py
```

## Implementation

### 1. Conversation Writer (server/conversations/writer.py)

```python
"""Save conversation messages to markdown files."""

import json
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any

import aiofiles
import aiofiles.os
import yaml

from db import query, query_one, execute, new_id
from files.storage import PROJECTS_ROOT


def get_metadata_path(project_id: str) -> Path:
    """Get path to project metadata directory."""
    return PROJECTS_ROOT / project_id / ".metadata"


def get_conversations_path(project_id: str) -> Path:
    """Get path to conversations directory."""
    return get_metadata_path(project_id) / ".conversations"


@dataclass
class Conversation:
    """Conversation metadata model."""
    id: str
    project_id: str
    title: str | None
    round_count: int
    settings: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_record(cls, record) -> "Conversation":
        """Create Conversation from database record."""
        settings = record["settings"]
        if isinstance(settings, str):
            settings = json.loads(settings)
        return cls(
            id=record["id"],
            project_id=record["project_id"],
            title=record["title"],
            round_count=record["round_count"],
            settings=settings or {},
            created_at=record["created_at"],
            updated_at=record["updated_at"]
        )


@dataclass
class Message:
    """Message metadata model."""
    id: str
    conversation_id: str
    round_number: int
    speaker: str
    file_path: str
    model_id: str | None
    provider: str | None
    input_tokens: int | None
    output_tokens: int | None
    created_at: datetime

    @classmethod
    def from_record(cls, record) -> "Message":
        """Create Message from database record."""
        return cls(
            id=record["id"],
            conversation_id=record["conversation_id"],
            round_number=record["round_number"],
            speaker=record["speaker"],
            file_path=record["file_path"],
            model_id=record["model_id"],
            provider=record["provider"],
            input_tokens=record["input_tokens"],
            output_tokens=record["output_tokens"],
            created_at=record["created_at"]
        )


async def create_conversation(
    project_id: str,
    title: str | None = None
) -> Conversation:
    """Create a new conversation."""
    conv_id = new_id("conv")

    await execute("""
        INSERT INTO conversations (id, project_id, title, round_count, settings)
        VALUES ($1, $2, $3, 0, '{}')
    """, conv_id, project_id, title)

    conv = await get_conversation(conv_id)
    if not conv:
        raise RuntimeError("Failed to create conversation")
    return conv


async def get_conversation(conversation_id: str) -> Conversation | None:
    """Get conversation by ID."""
    row = await query_one(
        "SELECT * FROM conversations WHERE id = $1",
        conversation_id
    )

    if not row:
        return None
    return Conversation.from_record(row)


async def list_conversations(project_id: str) -> list[Conversation]:
    """List conversations for a project."""
    rows = await query("""
        SELECT * FROM conversations
        WHERE project_id = $1
        ORDER BY updated_at DESC
    """, project_id)

    return [Conversation.from_record(row) for row in rows]


async def save_message(
    conversation_id: str,
    round_number: int,
    speaker: str,
    content: str,
    metadata: dict[str, Any] | None = None
) -> Message:
    """Save a message to markdown file."""
    metadata = metadata or {}

    conv = await get_conversation(conversation_id)
    if not conv:
        raise ValueError("Conversation not found")

    message_id = new_id("msg")
    timestamp = datetime.now(timezone.utc)

    # Prepare frontmatter
    frontmatter = {
        "id": message_id,
        "speaker": speaker,
        "round": round_number,
        "timestamp": timestamp.isoformat(),
    }

    # Add optional metadata fields
    if metadata.get("model"):
        frontmatter["model"] = metadata["model"]
    if metadata.get("provider"):
        frontmatter["provider"] = metadata["provider"]
    if metadata.get("usage"):
        frontmatter["usage"] = metadata["usage"]

    # Format as markdown with frontmatter
    yaml_str = yaml.dump(frontmatter, default_flow_style=False, sort_keys=False)
    markdown = f"---\n{yaml_str}---\n\n{content}"

    # Determine file path (replace colons in speaker name for filename)
    safe_speaker = speaker.replace(":", "-")
    filename = f"{round_number:03d}-{safe_speaker}.md"
    relative_path = f".metadata/.conversations/{conversation_id}/rounds/{filename}"

    # Write to filesystem
    full_path = PROJECTS_ROOT / conv.project_id / relative_path

    await aiofiles.os.makedirs(full_path.parent, exist_ok=True)
    async with aiofiles.open(full_path, "w", encoding="utf-8") as f:
        await f.write(markdown)

    # Store metadata in database
    await execute("""
        INSERT INTO conversation_messages (
            id, conversation_id, round_number, speaker, file_path,
            model_id, provider, input_tokens, output_tokens
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    """,
        message_id,
        conversation_id,
        round_number,
        speaker,
        relative_path,
        metadata.get("model"),
        metadata.get("provider"),
        metadata.get("usage", {}).get("input_tokens"),
        metadata.get("usage", {}).get("output_tokens")
    )

    # Update conversation round count and timestamp
    await execute("""
        UPDATE conversations
        SET round_count = GREATEST(round_count, $1)
        WHERE id = $2
    """, round_number, conversation_id)

    msg = await get_message(message_id)
    if not msg:
        raise RuntimeError("Failed to create message")
    return msg


async def get_message(message_id: str) -> Message | None:
    """Get message metadata from database."""
    row = await query_one(
        "SELECT * FROM conversation_messages WHERE id = $1",
        message_id
    )

    if not row:
        return None
    return Message.from_record(row)


async def list_messages(conversation_id: str) -> list[Message]:
    """List messages in a conversation."""
    rows = await query("""
        SELECT * FROM conversation_messages
        WHERE conversation_id = $1
        ORDER BY round_number, created_at
    """, conversation_id)

    return [Message.from_record(row) for row in rows]
```

### 2. Conversation Reader (server/conversations/reader.py)

```python
"""Read and parse conversation markdown files."""

from dataclasses import dataclass
from typing import Any

import aiofiles
import yaml

from files.storage import PROJECTS_ROOT
from .writer import (
    get_conversation,
    get_message,
    list_messages,
    Conversation,
    Message
)


@dataclass
class MessageWithContent:
    """Message with full content loaded from file."""
    id: str
    conversation_id: str
    round_number: int
    speaker: str
    file_path: str
    model_id: str | None
    provider: str | None
    input_tokens: int | None
    output_tokens: int | None
    content: str
    frontmatter: dict[str, Any]


def parse_markdown(markdown: str) -> tuple[dict[str, Any], str]:
    """
    Parse markdown file with YAML frontmatter.

    Returns:
        Tuple of (frontmatter dict, content string)
    """
    if not markdown.startswith("---\n"):
        return {}, markdown

    # Find end of frontmatter
    end_idx = markdown.find("\n---\n", 4)
    if end_idx == -1:
        return {}, markdown

    yaml_str = markdown[4:end_idx]
    content = markdown[end_idx + 5:].lstrip("\n")

    try:
        frontmatter = yaml.safe_load(yaml_str) or {}
    except yaml.YAMLError:
        frontmatter = {}

    return frontmatter, content


async def read_message(message_id: str) -> MessageWithContent:
    """Read message content from markdown file."""
    message = await get_message(message_id)
    if not message:
        raise ValueError("Message not found")

    conv = await get_conversation(message.conversation_id)
    if not conv:
        raise ValueError("Conversation not found")

    full_path = PROJECTS_ROOT / conv.project_id / message.file_path

    async with aiofiles.open(full_path, "r", encoding="utf-8") as f:
        markdown = await f.read()

    frontmatter, content = parse_markdown(markdown)

    return MessageWithContent(
        id=message.id,
        conversation_id=message.conversation_id,
        round_number=message.round_number,
        speaker=message.speaker,
        file_path=message.file_path,
        model_id=message.model_id,
        provider=message.provider,
        input_tokens=message.input_tokens,
        output_tokens=message.output_tokens,
        content=content,
        frontmatter=frontmatter
    )


@dataclass
class ConversationWithMessages:
    """Conversation with all messages and content."""
    id: str
    project_id: str
    title: str | None
    round_count: int
    settings: dict[str, Any]
    messages: list[MessageWithContent]


async def get_conversation_with_messages(
    conversation_id: str
) -> ConversationWithMessages:
    """Get full conversation with all messages and content."""
    conv = await get_conversation(conversation_id)
    if not conv:
        raise ValueError("Conversation not found")

    messages = await list_messages(conversation_id)

    # Load content for each message
    messages_with_content = []
    for msg in messages:
        full_msg = await read_message(msg.id)
        messages_with_content.append(full_msg)

    return ConversationWithMessages(
        id=conv.id,
        project_id=conv.project_id,
        title=conv.title,
        round_count=conv.round_count,
        settings=conv.settings,
        messages=messages_with_content
    )
```

### 3. Conversation Routes (server/conversations/routes.py)

```python
"""FastAPI routes for conversation operations."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from .writer import (
    create_conversation,
    get_conversation,
    list_conversations,
    save_message,
    list_messages,
    Conversation,
    Message
)
from .reader import get_conversation_with_messages


router = APIRouter(tags=["conversations"])


class CreateConversationRequest(BaseModel):
    """Request to create a conversation."""
    project_id: str
    title: str | None = None


class ConversationResponse(BaseModel):
    """Conversation metadata response."""
    id: str
    project_id: str
    title: str | None
    round_count: int

    @classmethod
    def from_conversation(cls, conv: Conversation) -> "ConversationResponse":
        return cls(
            id=conv.id,
            project_id=conv.project_id,
            title=conv.title,
            round_count=conv.round_count
        )


class MessageResponse(BaseModel):
    """Message metadata response."""
    id: str
    conversation_id: str
    round_number: int
    speaker: str
    file_path: str
    model_id: str | None
    provider: str | None
    input_tokens: int | None
    output_tokens: int | None

    @classmethod
    def from_message(cls, msg: Message) -> "MessageResponse":
        return cls(
            id=msg.id,
            conversation_id=msg.conversation_id,
            round_number=msg.round_number,
            speaker=msg.speaker,
            file_path=msg.file_path,
            model_id=msg.model_id,
            provider=msg.provider,
            input_tokens=msg.input_tokens,
            output_tokens=msg.output_tokens
        )


class MessageWithContentResponse(BaseModel):
    """Message with content response."""
    id: str
    conversation_id: str
    round_number: int
    speaker: str
    content: str
    model_id: str | None
    provider: str | None


class ConversationWithMessagesResponse(BaseModel):
    """Full conversation with messages response."""
    id: str
    project_id: str
    title: str | None
    round_count: int
    messages: list[MessageWithContentResponse]


class CreateMessageRequest(BaseModel):
    """Request to create a message."""
    round_number: int
    speaker: str
    content: str
    metadata: dict[str, Any] | None = None


class ConversationListResponse(BaseModel):
    """List of conversations response."""
    conversations: list[ConversationResponse]


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation_endpoint(
    request: CreateConversationRequest
) -> ConversationResponse:
    """Create a new conversation."""
    try:
        conv = await create_conversation(request.project_id, request.title)
        return ConversationResponse.from_conversation(conv)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations/{conversation_id}")
async def get_conversation_endpoint(
    conversation_id: str,
    include_content: bool = False
):
    """Get conversation with messages."""
    try:
        if include_content:
            # Load full content from files
            conv = await get_conversation_with_messages(conversation_id)
            return ConversationWithMessagesResponse(
                id=conv.id,
                project_id=conv.project_id,
                title=conv.title,
                round_count=conv.round_count,
                messages=[
                    MessageWithContentResponse(
                        id=m.id,
                        conversation_id=m.conversation_id,
                        round_number=m.round_number,
                        speaker=m.speaker,
                        content=m.content,
                        model_id=m.model_id,
                        provider=m.provider
                    )
                    for m in conv.messages
                ]
            )
        else:
            # Just metadata (faster)
            conv = await get_conversation(conversation_id)
            if not conv:
                raise HTTPException(status_code=404, detail="Conversation not found")

            messages = await list_messages(conversation_id)
            return {
                "id": conv.id,
                "project_id": conv.project_id,
                "title": conv.title,
                "round_count": conv.round_count,
                "messages": [MessageResponse.from_message(m).model_dump() for m in messages]
            }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations_endpoint(project_id: str) -> ConversationListResponse:
    """List conversations for a project."""
    try:
        conversations = await list_conversations(project_id)
        return ConversationListResponse(
            conversations=[ConversationResponse.from_conversation(c) for c in conversations]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse)
async def create_message_endpoint(
    conversation_id: str,
    request: CreateMessageRequest
) -> MessageResponse:
    """Add a message to conversation."""
    try:
        message = await save_message(
            conversation_id,
            request.round_number,
            request.speaker,
            request.content,
            request.metadata or {}
        )
        return MessageResponse.from_message(message)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 4. Integration Test (server/tests/test_conversations.py)

```python
"""Test conversation operations."""

import asyncio
import sys
import shutil
from pathlib import Path

# Add server to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import init_db, close_db
from db.projects import create_project, delete_project
from conversations.writer import (
    create_conversation,
    get_conversation,
    list_conversations,
    save_message,
    list_messages
)
from conversations.reader import read_message, get_conversation_with_messages
from files.storage import PROJECTS_ROOT


async def run_tests():
    """Run all conversation tests."""
    print("=== Testing Conversations ===\n")

    test_project = None

    try:
        # Initialize database
        await init_db()

        # Create test project
        print("1. Creating test project...")
        test_project = await create_project("Conversation Test", "Testing conversations")
        print(f"     Created project {test_project.id}\n")

        # Create conversation
        print("2. Creating conversation...")
        conv = await create_conversation(test_project.id, "Test Conversation")
        print(f"     Created conversation {conv.id}\n")

        # Save user message
        print("3. Saving user message...")
        user_msg = await save_message(
            conv.id,
            1,
            "user",
            "Hello, please analyze the data.",
            {}
        )
        print(f"     Saved user message {user_msg.id}")

        # Verify file exists
        msg_path = PROJECTS_ROOT / test_project.id / user_msg.file_path
        if not msg_path.exists():
            raise RuntimeError("Message file not written")
        print(f"     File created at {user_msg.file_path}\n")

        # Save agent message
        print("4. Saving agent message...")
        agent_msg = await save_message(
            conv.id,
            1,
            "agent:gpt-4o",
            "I will analyze the data for you.",
            {
                "model": "gpt-4o",
                "provider": "openai",
                "usage": {
                    "input_tokens": 150,
                    "output_tokens": 50
                }
            }
        )
        print(f"     Saved agent message {agent_msg.id}\n")

        # Read message content
        print("5. Reading message content...")
        full_msg = await read_message(user_msg.id)
        if full_msg.content != "Hello, please analyze the data.":
            raise RuntimeError("Message content mismatch")
        print("     Can read message content")
        print("     Frontmatter parsed correctly\n")

        # List messages
        print("6. Listing messages...")
        messages = await list_messages(conv.id)
        if len(messages) != 2:
            raise RuntimeError(f"Expected 2 messages, got {len(messages)}")
        print(f"     Listed {len(messages)} messages\n")

        # Get full conversation
        print("7. Getting full conversation...")
        full_conv = await get_conversation_with_messages(conv.id)
        if len(full_conv.messages) != 2:
            raise RuntimeError("Full conversation missing messages")
        if not full_conv.messages[0].content:
            raise RuntimeError("Messages missing content")
        print("     Full conversation loaded with content\n")

        # Test multiple rounds
        print("8. Testing multiple rounds...")
        await save_message(conv.id, 2, "user", "What about trends?", {})
        await save_message(
            conv.id,
            2,
            "agent:gpt-4o",
            "The trend is upward.",
            {"model": "gpt-4o", "provider": "openai"}
        )

        updated = await get_conversation(conv.id)
        if updated.round_count != 2:
            raise RuntimeError("Round count not updated")
        print(f"     Multiple rounds work, count: {updated.round_count}\n")

        # List conversations
        print("9. Listing conversations...")
        convs = await list_conversations(test_project.id)
        if len(convs) != 1:
            raise RuntimeError("Conversation not listed")
        print(f"     Listed {len(convs)} conversation(s)\n")

        print(" All conversation tests passed!")

    except Exception as err:
        print(f"\n Test failed: {err}")
        sys.exit(1)
    finally:
        # Cleanup
        if test_project:
            await delete_project(test_project.id)

            # Delete project directory
            project_dir = PROJECTS_ROOT / test_project.id
            if project_dir.exists():
                shutil.rmtree(project_dir)

        await close_db()


if __name__ == "__main__":
    asyncio.run(run_tests())
```

## Running

```bash
# Install dependencies
pip install aiofiles pyyaml

# Run integration tests
python -m server.tests.test_conversations
```

## Success Criteria

- [ ] Can create conversation
- [ ] Can save user messages to .md files
- [ ] Can save agent messages to .md files
- [ ] Messages have correct YAML frontmatter
- [ ] Can read message content from files
- [ ] Can list messages in conversation
- [ ] Can get full conversation with content
- [ ] Multiple rounds work correctly
- [ ] Round count increments properly
- [ ] Frontmatter includes all metadata (usage, model, etc.)
- [ ] Test script passes

## Common Issues

**"YAML parsing failed"**
→ Check frontmatter format, use `yaml.safe_load()` for safety

**"File path includes colons"**
→ Speaker names like `agent:gpt-4o` need colons replaced in filenames

**"Messages out of order"**
→ Ensure database query sorts by `round_number, created_at`

**"FileNotFoundError"**
→ Ensure `.metadata/.conversations/` directory is created

## Next Steps

After this step completes:
- **Step 05:** Add tool calling to generate messages during /api/turn
- **Step 06:** Index conversation messages for search

---

**Previous:** [02-filesystem-storage.md](02-filesystem-storage.md) | **Next:** [04-bubblewrap-execution.md](04-bubblewrap-execution.md)
