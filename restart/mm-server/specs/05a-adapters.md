# Step 05a: Model Adapters

**Goal:** Provider-specific API wrappers that handle tool calling loops.

**Complexity:** Medium (2-3 hours)

**Dependencies:** None (standalone module)

## Overview

Adapters wrap provider APIs (OpenAI, Anthropic, Google, xAI) with a consistent interface. Each adapter:
- Converts tool definitions to provider format
- Handles the tool-calling loop (call → execute → continue)
- Returns a uniform `AdapterResult(text, usage)`

Adapters are **independently testable** per provider. Adding a new provider shouldn't touch existing adapter code.

## File Structure

```
server/
  adapters/
    __init__.py
    base.py           # AdapterResult, shared types
    openai.py         # OpenAI/xAI adapter
    anthropic.py      # Anthropic adapter
    google.py         # Google Gemini adapter (future)
```

## Implementation

### 1. Shared Types (server/adapters/base.py)

```python
"""Shared types for model adapters."""

from dataclasses import dataclass
from typing import Any


@dataclass
class ToolDefinition:
    """Tool definition for model APIs."""
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class AdapterResult:
    """Result from model adapter."""
    text: str
    usage: dict[str, int]
    warning: str | None = None


@dataclass
class Message:
    """Simple message structure."""
    role: str
    content: str
```

### 2. OpenAI Adapter (server/adapters/openai.py)

```python
"""OpenAI API adapter with tool support."""

import json
import logging
import os
from typing import Any, Callable, Awaitable

from openai import AsyncOpenAI

from .base import ToolDefinition, AdapterResult, Message


logger = logging.getLogger(__name__)

# Initialize client (reads OPENAI_API_KEY from environment)
client = AsyncOpenAI()

MAX_TOOL_ITERATIONS = 10


def format_tool_for_openai(tool: ToolDefinition) -> dict[str, Any]:
    """Convert tool definition to OpenAI format."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters
        }
    }


async def send_openai(
    model: str,
    messages: list[Message],
    tools: list[ToolDefinition] | None = None,
    on_tool_call: Callable[[str, dict], Awaitable[Any]] | None = None
) -> AdapterResult:
    """
    Send messages to OpenAI with tool support.

    Args:
        model: OpenAI model ID (e.g., 'gpt-4o')
        messages: List of conversation messages
        tools: List of tool definitions
        on_tool_call: Async callback for tool execution

    Returns:
        AdapterResult with text, usage, and optional warning
    """
    tools = tools or []
    openai_messages = [{"role": msg.role, "content": msg.content} for msg in messages]
    openai_tools = [format_tool_for_openai(t) for t in tools] if tools else None

    completion = await client.chat.completions.create(
        model=model,
        messages=openai_messages,
        tools=openai_tools if openai_tools else None,
        tool_choice="auto" if openai_tools else None
    )

    usage = {
        "input_tokens": completion.usage.prompt_tokens,
        "output_tokens": completion.usage.completion_tokens
    }

    # Handle tool calls (with loop limit to prevent infinite loops)
    tool_iterations = 0

    while (
        completion.choices[0].finish_reason == "tool_calls"
        and tool_iterations < MAX_TOOL_ITERATIONS
    ):
        tool_iterations += 1
        tool_calls = completion.choices[0].message.tool_calls

        # Execute tools
        tool_results = []
        for tool_call in tool_calls:
            args = json.loads(tool_call.function.arguments)
            result = await on_tool_call(tool_call.function.name, args)

            tool_results.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "content": json.dumps(result)
            })

        # Add assistant message with tool calls
        openai_messages.append(completion.choices[0].message.model_dump())

        # Add tool results
        openai_messages.extend(tool_results)

        # Continue conversation
        completion = await client.chat.completions.create(
            model=model,
            messages=openai_messages,
            tools=openai_tools,
            tool_choice="auto"
        )

        # Accumulate usage
        usage["input_tokens"] += completion.usage.prompt_tokens
        usage["output_tokens"] += completion.usage.completion_tokens

    # Check if we hit the iteration limit
    if tool_iterations >= MAX_TOOL_ITERATIONS:
        logger.warning(f"Tool call loop limit reached ({MAX_TOOL_ITERATIONS} iterations)")
        partial_text = (
            completion.choices[0].message.content
            or "[Tool call limit reached - conversation stopped to prevent infinite loop]"
        )
        return AdapterResult(
            text=partial_text,
            usage=usage,
            warning="Maximum tool call iterations reached"
        )

    return AdapterResult(
        text=completion.choices[0].message.content or "",
        usage=usage
    )
```

### 3. Anthropic Adapter (server/adapters/anthropic.py)

```python
"""Anthropic API adapter with tool support."""

import json
import logging
from typing import Any, Callable, Awaitable

import anthropic

from .base import ToolDefinition, AdapterResult, Message


logger = logging.getLogger(__name__)

# Initialize client (reads ANTHROPIC_API_KEY from environment)
client = anthropic.AsyncAnthropic()

MAX_TOOL_ITERATIONS = 10


def format_tool_for_anthropic(tool: ToolDefinition) -> dict[str, Any]:
    """Convert tool definition to Anthropic format."""
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.parameters
    }


async def send_anthropic(
    model: str,
    messages: list[Message],
    system: str | None = None,
    tools: list[ToolDefinition] | None = None,
    on_tool_call: Callable[[str, dict], Awaitable[Any]] | None = None
) -> AdapterResult:
    """
    Send messages to Anthropic with tool support.

    Args:
        model: Anthropic model ID (e.g., 'claude-sonnet-4-5')
        messages: List of conversation messages
        system: System prompt
        tools: List of tool definitions
        on_tool_call: Async callback for tool execution

    Returns:
        AdapterResult with text, usage, and optional warning
    """
    tools = tools or []

    # Filter out system messages and convert to Anthropic format
    anthropic_messages = [
        {
            "role": "user" if msg.role == "user" else "assistant",
            "content": msg.content
        }
        for msg in messages
        if msg.role != "system"
    ]

    anthropic_tools = [format_tool_for_anthropic(t) for t in tools] if tools else None

    response = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=system or "",
        messages=anthropic_messages,
        tools=anthropic_tools if anthropic_tools else []
    )

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens
    }

    # Handle tool use (with loop limit to prevent infinite loops)
    tool_iterations = 0

    while response.stop_reason == "tool_use" and tool_iterations < MAX_TOOL_ITERATIONS:
        tool_iterations += 1

        # Find tool use blocks
        tool_use_blocks = [block for block in response.content if block.type == "tool_use"]

        # Execute tools
        tool_results = []
        for tool_use in tool_use_blocks:
            result = await on_tool_call(tool_use.name, tool_use.input)

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": json.dumps(result)
            })

        # Add assistant message
        anthropic_messages.append({
            "role": "assistant",
            "content": [block.model_dump() for block in response.content]
        })

        # Add tool results
        anthropic_messages.append({
            "role": "user",
            "content": tool_results
        })

        # Continue conversation
        response = await client.messages.create(
            model=model,
            max_tokens=4096,
            system=system or "",
            messages=anthropic_messages,
            tools=anthropic_tools
        )

        # Accumulate usage
        usage["input_tokens"] += response.usage.input_tokens
        usage["output_tokens"] += response.usage.output_tokens

    # Check if we hit the iteration limit
    if tool_iterations >= MAX_TOOL_ITERATIONS:
        logger.warning(f"Tool call loop limit reached ({MAX_TOOL_ITERATIONS} iterations)")
        text_blocks = [block for block in response.content if block.type == "text"]
        partial_text = (
            "\n".join(block.text for block in text_blocks)
            if text_blocks
            else "[Tool call limit reached - conversation stopped to prevent infinite loop]"
        )
        return AdapterResult(
            text=partial_text,
            usage=usage,
            warning="Maximum tool call iterations reached"
        )

    # Extract text from content blocks
    text_blocks = [block for block in response.content if block.type == "text"]
    text = "\n".join(block.text for block in text_blocks)

    return AdapterResult(text=text, usage=usage)
```

> **Adapter note:** Treat these adapter implementations as examples of the desired behavior and response shape (`AdapterResult(text, usage)`), not as a frozen SDK contract. SDKs change over time; keep all provider-specific quirks inside these adapter modules so the rest of the system can stay stable.

## Adding New Providers

To add a new provider (e.g., Google Gemini):

1. Create `server/adapters/google.py`
2. Implement `send_google()` returning `AdapterResult`
3. Handle tool format conversion for that provider
4. Add to the adapter selection in turn orchestration

Each adapter is independent—adding Google shouldn't touch OpenAI or Anthropic code.

## Success Criteria

- [ ] OpenAI adapter handles tool calling loop
- [ ] Anthropic adapter handles tool calling loop
- [ ] Both return consistent `AdapterResult` format
- [ ] Tool iteration limit prevents infinite loops
- [ ] Usage tracking accumulates across tool calls

---

**Previous:** [04-bubblewrap-execution.md](04-bubblewrap-execution.md) | **Next:** [05b-message-building.md](05b-message-building.md)
