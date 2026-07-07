# mm-server Implementation Specifications

Detailed implementation guides for the mm-server backend API.

## Specifications

### Foundation

| Spec | Description |
|------|-------------|
| [01-project-setup-and-schema.md](01-project-setup-and-schema.md) | Database schema, migrations |
| [02-filesystem-storage.md](02-filesystem-storage.md) | File storage APIs |
| [03-conversations-as-files.md](03-conversations-as-files.md) | Markdown conversation storage |

### Execution & Adapters

| Spec | Description |
|------|-------------|
| [04-bubblewrap-execution.md](04-bubblewrap-execution.md) | Sandboxed code execution |
| [05-tool-integration.md](05-tool-integration.md) | Overview of tool integration |
| [05a-adapters.md](05a-adapters.md) | Model provider adapters |
| [05b-message-building.md](05b-message-building.md) | Roundtable message building |
| [05c-turn-orchestration.md](05c-turn-orchestration.md) | /api/turn endpoint |

### Context & Prompts

| Spec | Description |
|------|-------------|
| [07-system-prompts.md](07-system-prompts.md) | System prompt construction |
| [09-conversation-context-management.md](09-conversation-context-management.md) | Context window management |

## Implementation Order

```
01 → 02 → 04 → 05 → 07 → 09
  ↘  03 ↗
```

## Related Specs in Other Projects

- [mm-search/specs/06](../../mm-search/specs/06-unified-search.md) - Search service
- [mm-web/specs/08](../../mm-web/specs/08-ui-and-testing.md) - Frontend UI
