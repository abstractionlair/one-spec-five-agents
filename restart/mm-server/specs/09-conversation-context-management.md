# Step 09: Conversation Context Management

**Goal:** Implement conversation summarization and pruning to handle conversations that exceed model context windows.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 05 (Tool integration), Step 07 (System prompts)

## Overview

As conversations grow, they will eventually exceed model context windows (typically 128k-200k tokens). This step implements strategies to:
- Detect when conversations are approaching context limits
- Summarize older conversation rounds
- Prune low-value messages
- Maintain conversation coherence

## Strategies

### 1. Rolling Window (Simple)
Keep only the N most recent messages, discarding older ones. Simple but loses context.

### 2. Summarization (Recommended)
Periodically summarize older rounds into condensed context. Preserves key information while reducing token count.

### 3. Hierarchical Summarization
Create multi-level summaries (per-round → multi-round → conversation). Allows flexible context retrieval.

## File Structure

```
server/
  conversations/
    context.py         # Context management
    summarizer.py      # Summarization logic
  tests/
    test_context.py    # Integration tests
```

## Implementation

### 1. Context Manager (server/conversations/context.py)

```python
"""Conversation context management for handling large conversations."""

from dataclasses import dataclass

from conversations.reader import get_conversation_with_messages
from indexing.chunker import estimate_tokens


MAX_CONTEXT_TOKENS = 100_000  # Conservative limit (most models support 128k+)
SUMMARIZATION_THRESHOLD = 80_000  # Trigger summarization at 80k tokens


@dataclass
class MessageWithTokens:
    """Message with token count."""
    speaker: str
    content: str
    round_number: int
    model_id: str | None
    tokens: int


@dataclass
class ContextResult:
    """Result of context message retrieval."""
    messages: list[MessageWithTokens]
    total_tokens: int
    truncated: bool
    dropped_messages: int


@dataclass
class SummaryContent:
    """Formatted content for summarization."""
    up_to_round: int
    message_count: int
    content: str


async def estimate_conversation_tokens(conversation_id: str) -> int:
    """Estimate total tokens in conversation."""
    conv = await get_conversation_with_messages(conversation_id)
    total_tokens = 0

    for msg in conv.messages:
        total_tokens += estimate_tokens(msg.content)

    return total_tokens


async def needs_summarization(conversation_id: str) -> bool:
    """Check if conversation needs summarization."""
    tokens = await estimate_conversation_tokens(conversation_id)
    return tokens > SUMMARIZATION_THRESHOLD


async def get_context_messages(
    conversation_id: str,
    max_tokens: int = MAX_CONTEXT_TOKENS
) -> ContextResult:
    """
    Get messages for model context with automatic pruning if needed.

    Keeps as many recent messages as possible within the token limit.
    """
    conv = await get_conversation_with_messages(conversation_id)
    messages = conv.messages

    # Calculate tokens per message
    messages_with_tokens = [
        MessageWithTokens(
            speaker=msg.speaker,
            content=msg.content,
            round_number=msg.round_number,
            model_id=msg.model_id,
            tokens=estimate_tokens(msg.content)
        )
        for msg in messages
    ]

    # Try to fit as many recent messages as possible
    selected_messages: list[MessageWithTokens] = []
    current_tokens = 0

    # Start from most recent and work backwards
    for msg in reversed(messages_with_tokens):
        if current_tokens + msg.tokens <= max_tokens:
            selected_messages.insert(0, msg)
            current_tokens += msg.tokens
        else:
            break

    return ContextResult(
        messages=selected_messages,
        total_tokens=current_tokens,
        truncated=len(selected_messages) < len(messages),
        dropped_messages=len(messages) - len(selected_messages)
    )


async def create_summary_content(
    conversation_id: str,
    up_to_round: int
) -> SummaryContent | None:
    """Create formatted content for summarization up to specified round."""
    conv = await get_conversation_with_messages(conversation_id)

    # Get messages up to specified round
    messages_to_summarize = [
        msg for msg in conv.messages
        if msg.round_number <= up_to_round
    ]

    if not messages_to_summarize:
        return None

    # Format messages for summarization
    formatted_parts = []
    for msg in messages_to_summarize:
        speaker = "User" if msg.speaker == "user" else (msg.model_id or "Assistant")
        formatted_parts.append(
            f"[Round {msg.round_number}] {speaker}: {msg.content}"
        )

    return SummaryContent(
        up_to_round=up_to_round,
        message_count=len(messages_to_summarize),
        content="\n\n".join(formatted_parts)
    )
```

### 2. Summarizer (server/conversations/summarizer.py)

```python
"""Conversation summarization using LLMs."""

import json
from dataclasses import dataclass
from datetime import datetime

from db import get_pool
from adapters.openai import send_openai
from adapters.anthropic import send_anthropic
from conversations.context import create_summary_content


SUMMARIZATION_PROMPT = """You are tasked with summarizing a conversation to preserve key information while reducing length.

Create a concise summary that captures:
- Main topics and questions asked
- Key decisions and conclusions
- Important code or data mentioned
- Action items or next steps

Be specific but brief. Focus on information that would be useful in continuing the conversation.

Conversation to summarize:
"""


@dataclass
class StoredSummary:
    """Summary stored in conversation metadata."""
    up_to_round: int
    content: str
    created_at: str
    message_count: int


async def summarize_rounds(
    conversation_id: str,
    up_to_round: int,
    provider: str = "openai",
    model_id: str = "gpt-4o-mini"
) -> str:
    """
    Summarize conversation rounds using a model.

    Args:
        conversation_id: Conversation to summarize
        up_to_round: Summarize messages up to this round
        provider: Model provider (openai, anthropic)
        model_id: Model to use for summarization

    Returns:
        Summary text
    """
    # Get formatted conversation content
    summary_content = await create_summary_content(conversation_id, up_to_round)
    if not summary_content:
        raise ValueError("No messages to summarize")

    prompt = SUMMARIZATION_PROMPT + "\n\n" + summary_content.content

    # Call model to create summary
    if provider == "openai":
        result = await send_openai(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            tools=[]
        )
    elif provider == "anthropic":
        result = await send_anthropic(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            system="You are a helpful assistant that creates concise summaries.",
            tools=[]
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")

    summary_text = result.text

    # Store summary in conversation metadata
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT settings FROM conversations WHERE id = $1",
            conversation_id
        )

        if row:
            settings = json.loads(row["settings"]) if row["settings"] else {}
            settings["summary"] = {
                "up_to_round": up_to_round,
                "content": summary_text,
                "created_at": datetime.now().isoformat(),
                "message_count": summary_content.message_count
            }

            await conn.execute(
                "UPDATE conversations SET settings = $1 WHERE id = $2",
                json.dumps(settings),
                conversation_id
            )

    return summary_text


async def get_summary(conversation_id: str) -> StoredSummary | None:
    """Get conversation summary if it exists."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT settings FROM conversations WHERE id = $1",
            conversation_id
        )

        if not row or not row["settings"]:
            return None

        settings = json.loads(row["settings"])
        summary_data = settings.get("summary")

        if not summary_data:
            return None

        return StoredSummary(
            up_to_round=summary_data["up_to_round"],
            content=summary_data["content"],
            created_at=summary_data["created_at"],
            message_count=summary_data["message_count"]
        )
```

### 3. Update Conversations Table Schema

Add a `settings` column to store summaries and other metadata:

```sql
-- In Step 01 schema.sql, update conversations table:
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  round_count INTEGER DEFAULT 0,
  settings JSONB,                -- { summary, preferences, etc. }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
```

### 4. Update Prompt Builder

Modify `server/prompts/builder.py` to use context-aware message retrieval:

```python
"""Updated prompt builder with context management."""

from db import get_pool
from conversations.context import get_context_messages
from conversations.summarizer import get_summary
from prompts.templates import build_system_prompt, BuiltMessages


async def build_messages(
    conversation_id: str,
    provider: str,
    model_id: str,
    round_number: int | None = None
) -> BuiltMessages:
    """Build conversation messages with context management."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM conversations WHERE id = $1",
            conversation_id
        )

        if not row:
            raise ValueError("Conversation not found")

        current_round = round_number or (row["round_count"] + 1)

    # Get context-managed messages (automatically handles truncation)
    # Leave room for system prompt (~20k tokens)
    context = await get_context_messages(conversation_id, 80_000)

    # Check if we have a summary
    summary = await get_summary(conversation_id)

    # Build system prompt
    system_prompt = await build_system_prompt(
        provider, model_id, row["project_id"], current_round
    )

    # Add summary to system prompt if available
    if summary:
        system_prompt += f"\n\n## Previous Conversation Summary\n\n"
        system_prompt += f"(Summary of rounds 1-{summary.up_to_round}, {summary.message_count} messages)\n\n"
        system_prompt += summary.content

    # Add truncation notice if needed
    if context.truncated:
        system_prompt += f"\n\n**Note:** This conversation has {context.dropped_messages} older messages not shown due to context limits. "
        if summary:
            system_prompt += "Key information is preserved in the summary above."
        else:
            system_prompt += "Consider summarizing if important context is missing."

    # Format messages
    chat_messages = [
        {
            "role": "user" if msg.speaker == "user" else "assistant",
            "content": msg.content
        }
        for msg in context.messages
    ]

    # Provider-specific formatting
    if provider == "openai":
        return BuiltMessages(
            system=None,
            messages=[
                {"role": "system", "content": system_prompt},
                *chat_messages
            ]
        )

    if provider == "anthropic":
        return BuiltMessages(
            system=system_prompt,
            messages=chat_messages
        )

    return BuiltMessages(
        system=None,
        messages=chat_messages
    )
```

### 5. Add Summarization API Endpoints

Add to `server/conversations/routes.py`:

```python
"""API endpoints for conversation context management."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_pool
from conversations.summarizer import summarize_rounds
from conversations.context import (
    estimate_conversation_tokens,
    needs_summarization,
    MAX_CONTEXT_TOKENS,
    SUMMARIZATION_THRESHOLD,
)


router = APIRouter(prefix="/api/conversations")


class SummarizeRequest(BaseModel):
    """Request body for summarization."""
    up_to_round: int | None = None
    provider: str = "openai"
    model_id: str = "gpt-4o-mini"


class SummarizeResponse(BaseModel):
    """Response from summarization."""
    summary: str
    up_to_round: int


class StatsResponse(BaseModel):
    """Conversation statistics response."""
    token_count: int
    needs_summarization: bool
    threshold: int
    max_tokens: int


@router.post("/{conversation_id}/summarize", response_model=SummarizeResponse)
async def summarize_conversation(
    conversation_id: str,
    request: SummarizeRequest
):
    """Manually trigger summarization of conversation rounds."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM conversations WHERE id = $1",
            conversation_id
        )

        if not row:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Default to summarizing up to the current round - 1
        target_round = request.up_to_round or (row["round_count"] - 1)

    try:
        summary = await summarize_rounds(
            conversation_id,
            target_round,
            provider=request.provider,
            model_id=request.model_id
        )

        return SummarizeResponse(
            summary=summary,
            up_to_round=target_round
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{conversation_id}/stats", response_model=StatsResponse)
async def get_conversation_stats(conversation_id: str):
    """Get conversation statistics (token count, needs summarization, etc.)."""
    try:
        token_count = await estimate_conversation_tokens(conversation_id)
        needs_summary = await needs_summarization(conversation_id)

        return StatsResponse(
            token_count=token_count,
            needs_summarization=needs_summary,
            threshold=SUMMARIZATION_THRESHOLD,
            max_tokens=MAX_CONTEXT_TOKENS
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 6. Integration Tests (server/tests/test_context.py)

```python
"""Integration tests for context management."""

import os
import shutil

import pytest

from db import init_db, close_db
from db.projects import create_project, delete_project
from conversations.writer import create_conversation, save_message
from conversations.context import (
    estimate_conversation_tokens,
    needs_summarization,
    get_context_messages,
)
from conversations.summarizer import summarize_rounds, get_summary
from files.storage import PROJECTS_ROOT


@pytest.fixture(scope="module")
async def db():
    """Initialize database for tests."""
    await init_db()
    yield
    await close_db()


@pytest.fixture
async def test_project(db):
    """Create test project with cleanup."""
    project = await create_project("Context Test", "Testing context management")
    yield project

    # Cleanup
    await delete_project(project.id)
    project_dir = PROJECTS_ROOT / project.id
    if project_dir.exists():
        shutil.rmtree(project_dir)


@pytest.fixture
async def conversation_with_messages(test_project):
    """Create conversation with multiple rounds of messages."""
    conv = await create_conversation(test_project.id, "Context Test Conv")

    # Add several rounds of messages
    for round_num in range(1, 6):
        await save_message(
            conv.id,
            round_num,
            "user",
            f"User message in round {round_num}. " * 20,  # ~100 tokens
            {}
        )

        await save_message(
            conv.id,
            round_num,
            "agent:gpt-4o",
            f"Assistant response in round {round_num}. " * 50,  # ~250 tokens
            {"model": "gpt-4o", "provider": "openai"}
        )

    return conv


@pytest.mark.asyncio
class TestContextManagement:
    """Tests for context management functionality."""

    async def test_token_estimation(self, conversation_with_messages):
        """Test that token estimation works."""
        conv = conversation_with_messages
        tokens = await estimate_conversation_tokens(conv.id)

        assert tokens > 0, "Token estimation should return positive count"
        # 5 rounds * (100 + 250 tokens) ≈ 1750 tokens
        assert tokens > 1000, "Should have substantial token count"

    async def test_needs_summarization(self, conversation_with_messages):
        """Test summarization threshold detection."""
        conv = conversation_with_messages

        # With small test data, should not need summarization
        needs_summary = await needs_summarization(conv.id)
        assert not needs_summary, "Small conversation should not need summarization"

    async def test_context_message_truncation(self, conversation_with_messages):
        """Test that context messages are truncated with low limit."""
        conv = conversation_with_messages

        # Use very low limit to force truncation
        context = await get_context_messages(conv.id, max_tokens=500)

        assert context.truncated, "Should be truncated with low token limit"
        assert context.dropped_messages > 0, "Should have dropped messages"
        assert len(context.messages) < 10, "Should have fewer than all messages"

    async def test_context_message_no_truncation(self, conversation_with_messages):
        """Test that context messages are not truncated with high limit."""
        conv = conversation_with_messages

        # Use high limit
        context = await get_context_messages(conv.id, max_tokens=100_000)

        assert not context.truncated, "Should not be truncated with high limit"
        assert context.dropped_messages == 0, "Should not have dropped messages"
        assert len(context.messages) == 10, "Should have all 10 messages"

    @pytest.mark.skipif(
        not os.getenv("OPENAI_API_KEY"),
        reason="OPENAI_API_KEY not set"
    )
    async def test_summarization(self, conversation_with_messages):
        """Test conversation summarization."""
        conv = conversation_with_messages

        # Summarize first 3 rounds
        summary = await summarize_rounds(
            conv.id,
            up_to_round=3,
            provider="openai",
            model_id="gpt-4o-mini"
        )

        assert summary, "Should return summary text"
        assert len(summary) > 0, "Summary should not be empty"

    @pytest.mark.skipif(
        not os.getenv("OPENAI_API_KEY"),
        reason="OPENAI_API_KEY not set"
    )
    async def test_summary_retrieval(self, conversation_with_messages):
        """Test retrieving stored summary."""
        conv = conversation_with_messages

        # First create a summary
        await summarize_rounds(
            conv.id,
            up_to_round=3,
            provider="openai",
            model_id="gpt-4o-mini"
        )

        # Then retrieve it
        retrieved = await get_summary(conv.id)

        assert retrieved is not None, "Should retrieve summary"
        assert retrieved.up_to_round == 3, "Should have correct round"
        assert retrieved.message_count == 6, "Should have 6 messages (3 rounds × 2)"
        assert retrieved.content, "Should have content"


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
```

## Running

```bash
# Run context management tests
pytest server/tests/test_context.py -v

# Run with API key for full tests (including summarization)
OPENAI_API_KEY=sk-... pytest server/tests/test_context.py -v
```

## Usage

### Automatic Context Management

The system automatically handles context limits when building prompts:

```python
# In /api/turn, context is automatically managed
from prompts.builder import build_messages

built = await build_messages(
    conversation_id=conversation_id,
    provider=provider,
    model_id=model_id,
    round_number=round_number
)
# built.messages will only include messages that fit in context
```

### Manual Summarization

Users can trigger summarization via API:

```bash
curl -X POST http://localhost:8000/api/conversations/conv_123/summarize \
  -H 'Content-Type: application/json' \
  -d '{"up_to_round": 10, "provider": "openai", "model_id": "gpt-4o-mini"}'
```

### Check Conversation Stats

```bash
curl http://localhost:8000/api/conversations/conv_123/stats
# Returns: { "token_count": 45000, "needs_summarization": false, ... }
```

## Success Criteria

- [ ] Can estimate conversation token count
- [ ] Can detect when summarization is needed
- [ ] Can retrieve context-limited messages (with automatic pruning)
- [ ] Can create summaries using models (OpenAI/Anthropic)
- [ ] Summaries stored in conversation JSONB settings
- [ ] Prompt builder includes summaries in system prompt
- [ ] Truncation notices added to system prompt
- [ ] FastAPI endpoints work correctly
- [ ] pytest tests pass

## Future Enhancements

1. **Semantic Chunking** - Keep messages with high semantic similarity to current query
2. **Importance Scoring** - Preserve high-value messages even if old
3. **Hierarchical Summaries** - Multi-level summaries for very long conversations
4. **Compression** - LLMLingua-style compression instead of summarization
5. **Vector Search** - Retrieve relevant past messages based on semantic similarity

## Next Steps

This completes the core implementation. Consider:
- **Production deployment** - Environment setup, monitoring
- **Performance optimization** - Caching, batch operations
- **Additional features** - Multi-user, real-time updates

---

**Previous:** [08-ui-and-testing.md](08-ui-and-testing.md) | **Roadmap:** [ROADMAP.md](../ROADMAP.md)
