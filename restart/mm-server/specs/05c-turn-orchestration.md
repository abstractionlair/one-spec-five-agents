# Step 05c: Turn Orchestration

**Goal:** Wire together adapters, message building, and tools in the /api/turn endpoint.

**Complexity:** Medium (2-3 hours)

**Dependencies:** Step 05a (Adapters), Step 05b (Message Building), Step 04 (Sandbox)

## Overview

The `/api/turn` endpoint orchestrates a single conversation turn:

1. Save user message to conversation
2. Build per-model message views (roundtable)
3. Query all models in parallel
4. Handle tool calls via sandbox
5. Save agent responses
6. Return results

## File Structure

```
server/
  main.py             # FastAPI app, /api/turn route
  execution/
    tools.py          # Tool definitions and executor
```

## Implementation

### 1. Tool Definitions (server/execution/tools.py)

```python
"""Tool definitions and executor for sandbox commands."""

from dataclasses import dataclass
from typing import Any

from execution.sandbox import execute_bash


@dataclass
class ToolResult:
    """Result of a tool execution."""
    stdout: str
    stderr: str
    exit_code: int
    success: bool


# Reuse ToolDefinition from adapters
from adapters.base import ToolDefinition

BASH_TOOL = ToolDefinition(
    name="bash",
    description=(
        "Execute bash commands in the project directory. Use this to create files, "
        "run scripts, install packages, analyze data, etc. Commands run in a "
        "bubblewrap sandbox with access to the project directory."
    ),
    parameters={
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The bash command to execute. Can be multiline. Working directory is /workspace."
            }
        },
        "required": ["command"]
    }
)


async def execute_tool(
    tool_name: str,
    args: dict[str, Any],
    project_id: str,
    timeout: int = 60,
    network: bool = True
) -> ToolResult:
    """
    Execute a tool call.

    Args:
        tool_name: Name of the tool to execute
        args: Tool arguments
        project_id: Project ID for workspace directory
        timeout: Maximum execution time in seconds
        network: Whether to allow network access

    Returns:
        ToolResult with stdout, stderr, exit_code, success

    Raises:
        ValueError: If tool_name is unknown or args are invalid
    """
    if tool_name == "bash":
        command = args.get("command")
        if not command:
            raise ValueError("bash tool requires command argument")

        result = await execute_bash(
            command=command,
            project_id=project_id,
            timeout=timeout,
            network=network
        )

        return ToolResult(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.exit_code,
            success=result.success
        )

    raise ValueError(f"Unknown tool: {tool_name}")
```

### 2. Main Server (server/main.py)

```python
"""FastAPI main application with /api/turn endpoint."""

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import init_db, close_db
from conversations.writer import create_conversation, save_message, get_conversation
from adapters.base import Message
from adapters.openai import send_openai
from adapters.anthropic import send_anthropic
from prompts.builder import build_messages
from execution.tools import BASH_TOOL, execute_tool


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize and cleanup resources."""
    await init_db()
    yield
    await close_db()


app = FastAPI(lifespan=lifespan)


# Request/Response models
class TargetModel(BaseModel):
    """Target model specification."""
    provider: str  # 'openai', 'anthropic', 'google'
    model_id: str  # e.g., 'gpt-4o', 'claude-sonnet-4-5'


class TurnRequest(BaseModel):
    """Request body for /api/turn."""
    project_id: str
    conversation_id: str | None = None
    user_message: str
    target_models: list[TargetModel]
    round_number: int | None = None


class ModelResponse(BaseModel):
    """Response from a single model."""
    provider: str
    model_id: str
    response: str | None = None
    usage: dict[str, int] | None = None
    error: str | None = None


class TurnResponse(BaseModel):
    """Response body for /api/turn."""
    conversation_id: str
    round_number: int
    responses: list[ModelResponse]


@app.post("/api/turn", response_model=TurnResponse)
async def turn(request: TurnRequest) -> TurnResponse:
    """
    Send message to multiple models, get responses.

    Each model can call the bash tool to execute code in a sandbox.
    User and agent messages are saved to the conversation.
    """
    # Ensure conversation exists (create if needed)
    conversation_id = request.conversation_id
    if not conversation_id:
        conv = await create_conversation(request.project_id, None)
        conversation_id = conv.id

    # Determine round number (auto-increment if not provided)
    conv_meta = await get_conversation(conversation_id)
    effective_round = request.round_number or (conv_meta.round_count + 1)

    # Save user message for this round
    await save_message(
        conversation_id=conversation_id,
        round_number=effective_round,
        speaker="user",
        content=request.user_message,
        metadata={}
    )

    # Query each model in parallel
    async def query_model(target: TargetModel) -> ModelResponse:
        try:
            # Build conversation history + system prompt for this model
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
                    network=True  # Allow network by default
                )
                return asdict(result)

            # Call appropriate adapter
            if target.provider == "openai":
                result = await send_openai(
                    model=target.model_id,
                    messages=[Message(role=m["role"], content=m["content"]) for m in built.messages],
                    tools=[BASH_TOOL],
                    on_tool_call=on_tool_call
                )
            elif target.provider == "anthropic":
                result = await send_anthropic(
                    model=target.model_id,
                    messages=[Message(role=m["role"], content=m["content"]) for m in built.messages],
                    system=built.system,
                    tools=[BASH_TOOL],
                    on_tool_call=on_tool_call
                )
            else:
                raise ValueError(f"Unknown provider: {target.provider}")

            # Save agent response
            await save_message(
                conversation_id=conversation_id,
                round_number=effective_round,
                speaker=f"agent:{target.model_id}",
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


# Mount routes
from files.routes import router as file_router
from projects.routes import router as project_router
from conversations.routes import router as conversation_router

app.include_router(file_router)
app.include_router(project_router)
app.include_router(conversation_router)

# Serve static files (web UI)
app.mount("/", StaticFiles(directory="web", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
```

## Data Flow

```
POST /api/turn
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Create/load conversation                             │
│ 2. Save user message                                    │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│ For each target model (in parallel):                    │
│                                                         │
│   ┌──────────────────────────────────────────────────┐  │
│   │ build_messages() → Roundtable view for this model│  │
│   └──────────────────────────────────────────────────┘  │
│                         │                               │
│                         ▼                               │
│   ┌──────────────────────────────────────────────────┐  │
│   │ send_openai() / send_anthropic()                 │  │
│   │    ├─ Tool call? → execute_tool() → sandbox      │  │
│   │    └─ Final response                             │  │
│   └──────────────────────────────────────────────────┘  │
│                         │                               │
│                         ▼                               │
│   ┌──────────────────────────────────────────────────┐  │
│   │ save_message() → Store agent response            │  │
│   └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
     │
     ▼
Return TurnResponse with all model responses
```

## Success Criteria

- [ ] `/api/turn` endpoint works
- [ ] Can send message to single model
- [ ] Model can call bash tool
- [ ] Tool results returned to model
- [ ] Model generates final response
- [ ] User and agent messages saved to conversation
- [ ] Works with OpenAI models
- [ ] Works with Anthropic models
- [ ] Can query multiple models in parallel
- [ ] Usage tracking works (token counts)

---

**Previous:** [05b-message-building.md](05b-message-building.md) | **Next:** [06-unified-search.md](06-unified-search.md)
