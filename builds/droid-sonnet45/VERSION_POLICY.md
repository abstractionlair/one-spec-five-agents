# Version Policy

## Philosophy

This project uses **"latest stable"** language in documentation and specifications to avoid outdated version references. Specific version numbers in planning documents become stale quickly.

## Current Versions (as of November 2024)

These are the actual versions used in `package.json`. Update this section when upgrading:

### Runtime
- **Node.js**: 20.18.1 (LTS)
  - Requirement: Node.js 20 LTS or later
  - Note: Node 24 not compatible with better-sqlite3

### Dependencies
- **better-sqlite3**: ^12.2.0 (SQLite with FTS5)
- **express**: ^4.21.2 (Web framework)
- **openai**: ^6.9.0 (OpenAI API client)
- **@anthropic-ai/sdk**: ^0.70.1 (Anthropic API client)
- **multer**: ^1.4.5-lts.1 (File uploads)
- **axios**: ^1.6.0 (HTTP client)
- **dotenv**: ^16.3.1 (Environment variables)

### AI Models (Current Names)

**OpenAI:**
- `gpt-4o` - Latest flagship model
- `gpt-4o-mini` - Fast, cost-effective model
- Note: Model names change; check OpenAI docs for current options

**Anthropic:**
- `claude-sonnet-4-5` - Most intelligent model
- `claude-opus-4-1` - Specialized reasoning
- `claude-haiku-4-5` - Fastest model
- Note: Model names evolve; check Anthropic docs for current options

## Documentation Guidelines

### ✅ DO use generic language:
- "Node.js LTS (20.x or later)"
- "latest stable version of better-sqlite3"
- "current OpenAI GPT-4 models"
- "recent Anthropic Claude models"

### ❌ DON'T hardcode versions in specs:
- ~~"Node.js 18+"~~ (becomes outdated)
- ~~"better-sqlite3 9.2.2"~~ (specific version in docs)
- ~~"gpt-4o-mini"~~ (model names change)

### Exception: package.json
- DOES contain specific versions with semver ranges
- Update during dependency upgrades
- Document current versions in this file

## Checking for Updates

```bash
# Check all outdated packages
npm outdated

# Update to latest versions
npm update

# Update specific package to latest
npm install better-sqlite3@latest
```

## When to Update

1. **Security fixes** - Update immediately
2. **Bug fixes** - Update soon
3. **New features** - Evaluate need
4. **Major versions** - Test thoroughly

## Compatibility Notes

- **Node 20 LTS required** - better-sqlite3 compilation requires Node 20
- **Express 4.x** - Staying on v4 (v5 is major rewrite)
- **Multer 1.x** - Known vulnerabilities, but 2.x not stable yet
