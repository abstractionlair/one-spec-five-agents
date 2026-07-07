# Step 05b: Roundtable Message Building

**Goal:** Build per-model conversation views where each model sees other models' responses.

**Complexity:** Medium (2-3 hours)

**Dependencies:** Step 03 (Conversations)

## Overview

This is the **core differentiator** of the multi-model chat system. Each model gets a personalized view of the conversation:

- **Other models' responses** appear as tagged blocks: `[GPT-4]: ...`
- **Its own prior responses** appear as normal `assistant` messages
- **User messages** are prefixed with `User:` in the tagged blocks

This creates the "roundtable" dynamic where models can build on, disagree with, or synthesize each other's ideas.

## File Structure

```
server/
  prompts/
    __init__.py
    builder.py      # build_messages, build_tagged_block
```

## Implementation

### Prompt Builder (server/prompts/builder.py)

```python
"""Build conversation messages for model APIs with roundtable support."""

from dataclasses import dataclass

from conversations.reader import get_conversation_with_messages, MessageWithContent


@dataclass
class BuiltMessages:
    """Messages built for a specific model."""
    system: str | None
    messages: list[dict[str, str]]


DEFAULT_MULTI_MODEL_PROMPT = """You are {model_id} in a multi-agent conversation with one user and multiple AI agents.
You will see the full conversation from the beginning: each user message followed by other agents' replies tagged in brackets, e.g., [GPT-4]: ...

Your own previous replies appear as assistant messages.

Respond once per user turn, primarily addressing the user directly but also addressing the other models as appropriate.

Coordination: Replies are collected in parallel and shown together; do not claim to "go first" or "start the discussion". Avoid meta-openers; contribute your content directly."""


def build_tagged_block(
    user_content: str,
    agents: list[MessageWithContent],
    target_model_id: str
) -> str:
    """
    Build a user message block with tagged responses from other models.

    Args:
        user_content: The user's message
        agents: All agent responses in this round
        target_model_id: The model we're building for (to exclude its own responses)

    Returns:
        A string with the user message followed by tagged other-model responses
    """
    lines = [f"User: {user_content}"]

    for agent in agents:
        # Skip if this is the target model's response
        if agent.model_id == target_model_id:
            continue

        # Tag other models' responses: [ModelName]: response
        tag = agent.model_id or "agent"
        if agent.content and agent.content.strip():
            lines.append(f"[{tag}]: {agent.content.strip()}")

    return "\n".join(lines)


async def build_messages(
    conversation_id: str,
    provider: str,
    model_id: str,
    round_number: int
) -> BuiltMessages:
    """
    Build messages for a model API call with roundtable context.

    Each model gets a personalized view where:
    - Other models' responses appear as tagged blocks in user messages
    - Its own prior responses appear as assistant messages

    Args:
        conversation_id: The conversation to load
        provider: Provider name (for system prompt customization)
        model_id: The model we're building messages for
        round_number: Current round number

    Returns:
        BuiltMessages with system prompt and message list
    """
    # Load full conversation
    conv = await get_conversation_with_messages(conversation_id)

    # Build system prompt
    system = DEFAULT_MULTI_MODEL_PROMPT.format(model_id=model_id)

    # Group messages by round
    rounds: dict[int, dict] = {}
    for msg in conv.messages:
        rn = msg.round_number
        if rn not in rounds:
            rounds[rn] = {"user": None, "agents": []}

        if msg.speaker == "user":
            rounds[rn]["user"] = msg
        else:
            rounds[rn]["agents"].append(msg)

    # Build per-model message history
    messages = []

    for rn in sorted(rounds.keys()):
        if rn > round_number:
            continue  # Don't include future rounds

        round_data = rounds[rn]
        user_msg = round_data["user"]
        agents = round_data["agents"]

        if not user_msg:
            continue

        if rn < round_number:
            # Past round: include user + tagged other models + own response as assistant
            user_block = build_tagged_block(user_msg.content, agents, model_id)
            messages.append({"role": "user", "content": user_block})

            # Find this model's response in this round
            my_response = next(
                (a for a in agents if a.model_id == model_id),
                None
            )
            if my_response:
                messages.append({"role": "assistant", "content": my_response.content})

        else:
            # Current round: just the user message (no tagged responses yet)
            messages.append({"role": "user", "content": f"User: {user_msg.content}"})

    return BuiltMessages(system=system, messages=messages)
```

## How This Creates the Roundtable Effect

1. **For past rounds**, each model sees:
   - User message + `[OtherModel]: ...` tags in a single `user` message
   - Its own prior response as an `assistant` message

2. **For the current round**:
   - Only the user message (other models haven't responded yet)

3. **Each model gets a unique view** based on its `model_id`

## Example Output

**For Claude in Round 2:**
```python
BuiltMessages(
    system="You are claude-opus in a multi-agent conversation...",
    messages=[
        {"role": "user", "content": "User: What are microservices?\n[GPT-4]: Microservices are..."},
        {"role": "assistant", "content": "The key tradeoff is..."},  # Claude's Round 1 response
        {"role": "user", "content": "User: Which do you recommend?"}
    ]
)
```

**For GPT-4 in Round 2:**
```python
BuiltMessages(
    system="You are gpt-4o in a multi-agent conversation...",
    messages=[
        {"role": "user", "content": "User: What are microservices?\n[Claude]: The key tradeoff is..."},
        {"role": "assistant", "content": "Microservices are..."},  # GPT-4's Round 1 response
        {"role": "user", "content": "User: Which do you recommend?"}
    ]
)
```

## Success Criteria

- [ ] Each model sees other models' responses as tagged blocks
- [ ] Each model sees its own responses as assistant messages
- [ ] System prompt explains the multi-model format
- [ ] Current round only shows user message (no other responses yet)
- [ ] Works correctly for 2+ models

---

**Previous:** [05a-adapters.md](05a-adapters.md) | **Next:** [05c-turn-orchestration.md](05c-turn-orchestration.md)
