# Guidelines for Droid (Factory AI Agent)

This document provides specific guidance for Droid when working on this codebase. For general coding standards, refer to [CLAUDE.md](CLAUDE.md).

## About Droid

Droid is Factory's AI software engineering agent, optimized for:
- Parallel tool execution (making multiple tool calls simultaneously)
- Complex multi-file edits
- Systematic debugging and problem-solving
- Following project-specific conventions

## Key Differences from CLAUDE.md

While CLAUDE.md provides the foundation, Droid should be aware of these specific capabilities:

### 1. Parallel Tool Execution

**Leverage this capability aggressively** to speed up work:

```javascript
// GOOD: Parallel exploration
- Read multiple spec files simultaneously
- Grep for multiple patterns at once
- Search different directories in parallel

// When starting a task:
- Read relevant files + Grep for patterns + LS directories ALL AT ONCE
- Don't wait for one result before starting the next search
```

### 2. Todo List Management

Use `TodoWrite` tool in parallel with work:

```javascript
// GOOD: Start working immediately
TodoWrite(...) + Read(...) + Grep(...) // All in parallel

// When user provides specific commands:
- Capture exact commands in todos (preserve all flags/arguments)
- Track multi-step processes
- Update status in real-time
```

### 3. Complex Multi-File Changes

Droid excels at:
- Coordinated changes across multiple files
- Schema migrations with code updates
- Refactoring that touches many files

**Approach:**
1. Identify all affected files (parallel Grep/Glob)
2. Plan changes holistically
3. Execute edits systematically
4. Verify consistency

## Project-Specific Notes

### Architecture Understanding

Before making changes, ensure you understand:
- **Filesystem-first**: Files are source of truth, DB has metadata
- **Ephemeral Docker**: Containers are stateless (`--rm`)
- **No duplication**: Content lives in ONE place (file OR database, never both)

### Common Patterns to Follow

1. **ID Generation**: Always use `newId(prefix)` from `server/db/projects.js`
2. **Path Sanitization**: Always use `sanitizePath()` from `server/utils/sanitize.js`
3. **Hash for Changes**: Use content hashes to detect file changes
4. **Database**: Synchronous API (better-sqlite3), not async

### Security Checklist

Before commits involving file operations or execution:
- [ ] All user paths go through `sanitizePath()`
- [ ] Docker containers have resource limits
- [ ] No API keys in code (only `.env`)
- [ ] No sensitive data in logs

### Testing Philosophy

**Always test before considering work complete:**

1. Run relevant test script
2. Check for errors in output
3. Verify success criteria from spec
4. If tests fail, debug systematically

### When Implementing Specs

Each spec in `specs/` has:
- Clear success criteria
- Complete code examples
- Test scripts

**Follow this order:**
1. Read the spec thoroughly
2. Check dependencies are met
3. Implement code from spec (adapt, don't blindly copy)
4. Run the test script
5. Fix any failures
6. Mark success criteria complete

## Common Pitfalls to Avoid

1. **Don't mix async/sync**: `better-sqlite3` is synchronous, `fs.promises` is async
2. **Don't store content in DB**: Files and conversations live on filesystem
3. **Don't use long-running containers**: Always ephemeral (`docker run --rm`)
4. **Don't skip path sanitization**: Security vulnerability
5. **Don't assume tool calls always succeed**: Models can request invalid bash commands

## Debugging Strategy

When tests fail:

1. **Read error messages carefully**: They often point to exact issue
2. **Check system reminders**: Important context about file changes
3. **Verify file existence**: Use LS before creating/editing
4. **Check database state**: Use sqlite3 CLI to inspect tables
5. **Test Docker separately**: Run `docker run --rm ...` manually

## Git Workflow

When creating commits:

1. Run `git status` and `git diff` IN PARALLEL
2. Review ALL changes before committing
3. Check for secrets/API keys/sensitive data
4. Write clear commit message (reference spec if relevant)
5. Include co-authorship:
   ```
   git commit -m "Implement Step XX: Feature name
   
   Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
   ```

## Performance Optimization

**Make work faster by:**
- Parallel tool calls (aggressive use)
- Todo tracking during work (not after)
- Pattern: Read + Grep + LS simultaneously when exploring
- Batch related file operations

## Model-Specific Considerations

When working with model adapters (`server/adapters/`):

- **Test with actual API calls** (if keys available)
- **Handle tool call loops** (now limited to 10 iterations)
- **Respect provider differences** (OpenAI vs Anthropic formats)
- **Track token usage** accurately

## Conversation Context Management (Step 09)

When implementing or debugging Step 09:

- Token estimation is approximate (4 chars ≈ 1 token)
- Summaries should preserve key info, not just compress
- Test with actually long conversations (50+ messages)
- Verify prompt builder integrates summaries correctly

## Questions?

If unclear about:
- Architecture decisions → Read ARCHITECTURE.md
- Implementation details → Check spec in specs/
- Why a constraint exists → Read VISION.md

## Remember

1. **CLAUDE.md is the primary reference** - this doc just adds Droid-specific notes
2. **Test everything** - no task is complete without verification
3. **Parallel execution** - your superpower, use it
4. **Security first** - sanitize inputs, limit resources, no secrets in code

---

Good luck! You've got this. 🤖
