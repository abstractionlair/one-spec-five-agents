# Step 05: Tool Integration (Overview)

**Goal:** Enable models to execute code and see each other's responses in a roundtable conversation.

**Complexity:** High (6-8 hours total)

**Dependencies:** Step 03 (Conversations), Step 04 (Bubblewrap execution)

## Overview

This step is split into three orthogonal components:

| Sub-step | Focus | Complexity |
|----------|-------|------------|
| [05a-adapters.md](05a-adapters.md) | Provider API wrappers (OpenAI, Anthropic) | 2-3 hours |
| [05b-message-building.md](05b-message-building.md) | Roundtable per-model views | 2-3 hours |
| [05c-turn-orchestration.md](05c-turn-orchestration.md) | /api/turn endpoint wiring | 2-3 hours |

## Why Split?

These components are **orthogonal**—changes to one shouldn't require changes to others:

- **Adapters** are provider-specific. Adding Google/xAI shouldn't touch Anthropic code.
- **Message building** is the core roundtable logic. It's testable independently.
- **Orchestration** wires everything together. It's where dependencies meet.

## Key Concepts

### The Roundtable Pattern

Each model gets a **personalized view** of the conversation:
- Other models' responses appear as `[ModelName]: ...` tags
- Its own responses appear as normal `assistant` messages

This enables cross-model discussion where models can build on each other's ideas.

### Tool Calling

Models can call the `bash` tool to execute commands in a bubblewrap sandbox. The adapter handles the tool-calling loop (call → execute → continue) until the model produces a final response.

### Parallel Execution

All target models are queried simultaneously via `asyncio.gather()`. Each gets its own personalized message view built at query time.

## File Structure

```
server/
  main.py               # /api/turn endpoint (05c)
  adapters/
    base.py             # Shared types (05a)
    openai.py           # OpenAI adapter (05a)
    anthropic.py        # Anthropic adapter (05a)
  prompts/
    builder.py          # build_messages, roundtable (05b)
  execution/
    sandbox.py          # Bubblewrap (Step 04)
    tools.py            # Tool definitions (05c)
```

## Implementation Order

1. **05a-adapters.md** - Can be tested with mock tool callbacks
2. **05b-message-building.md** - Can be tested with fixture conversations
3. **05c-turn-orchestration.md** - Integrates everything

## Success Criteria

See individual sub-specs for detailed criteria. Overall:

- [ ] Models can execute bash commands in sandbox
- [ ] Models see each other's responses (roundtable)
- [ ] Multiple models queried in parallel
- [ ] Tool calling loops handled correctly
- [ ] Messages saved to conversation

---

**Previous:** [04-bubblewrap-execution.md](04-bubblewrap-execution.md) | **Next:** [06-unified-search.md](06-unified-search.md)
