# Documentation Updates for Evergreen Versions

## Summary

Updated documentation to use generic, evergreen language instead of specific version numbers and model names. This ensures documentation remains valid as technology evolves.

## Changes Made

### 1. README.md ✓
- Added note about using current flagship models and latest stable versions
- Changed model references from specific names to provider names (OpenAI, Anthropic, Google)

### 2. ROADMAP.md ✓
- Added note about using current production models at implementation time
- Updated example frontmatter: `gpt-4o` → `openai-flagship-model`

### 3. specs/08-ui-and-testing.md ✓
- Updated package.json example dependencies from specific versions to `"latest"`
- Added note explaining to use current stable releases at implementation time
- Updated dependencies:
  - `better-sqlite3: "^9.2.2"` → `"latest"`
  - `openai: "^4.20.1"` → `"latest"`
  - `@anthropic-ai/sdk: "^0.10.0"` → `"latest"`
  - Added `@google/generative-ai`, `cors`, `dotenv` as `"latest"`

### 4. ARCHITECTURE.md ✓
- Added note explaining code examples use placeholder model names
- Note directs implementers to use current production models
- Model references in examples left as placeholders (clearly illustrative)

### 5. specs/01-project-setup-and-schema.md ✓
- Added note explaining examples use generic placeholders
- Updated schema comment: `"gpt-4o", "claude-sonnet-4-5"` → `"openai-flagship", "anthropic-flagship"`

### 6. specs/03-conversations-as-files.md ✓
- Added note about placeholder model names in examples
- Updated directory structure example filenames to use generic model identifiers
- Updated message format frontmatter to use generic model IDs

### 7. specs/06-unified-search.md ✓
- Added note explaining code examples use placeholder model names
- Model references in test code left as examples (covered by note)

### 8. specs/07-system-prompts.md ✓
- Added note explaining test code uses placeholder model names
- Model references in test code left as examples (covered by note)

### 9. specs/09-conversation-context-management.md ✓
- Added note explaining code examples use placeholder model names
- Model references in code examples left as placeholders (covered by note)

## Recommendation

**Code examples** can keep specific model names (like `gpt-4o`) as placeholders since they're clearly示examples, but consider adding comments like:
```javascript
// Example using OpenAI's current flagship model
model: "gpt-4o"  // Replace with current model at implementation time
```

**Package versions in specs** should always use `"latest"` or generic language.

## Philosophy

**Documentation = Evergreen**
- Use generic references: "current flagship model", "latest stable release"
- Avoid specific version numbers that will become outdated

**Implementation = Specific**
- `package.json` in actual project has specific/ranged versions that work
- `.env.example` has current model IDs
- Implementation files lock to working versions

## Impact

Future implementers (human or AI) will:
1. Read "use latest stable release of better-sqlite3"
2. Check what that is at their time (e.g., v15.x in 2026)
3. Install the current version, avoiding outdated dependencies

This prevents the Node.js 24 + better-sqlite3 9.2.2 compatibility issue from recurring.
