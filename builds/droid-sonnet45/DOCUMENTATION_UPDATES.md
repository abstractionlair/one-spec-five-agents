# Documentation Version References - Updated

## Summary of Changes

All documentation has been updated to use generic "latest stable" language instead of specific version numbers that quickly become outdated.

## What Changed

### Package Versions
- **Before**: Specific versions like `better-sqlite3 9.2.2` or `openai 4.20.0`
- **After**: `package.json` contains actual versions (12.2.0, 6.9.0, etc.) with semver ranges
- **In Docs**: Reference "latest stable version" or link to npm

### Node.js Versions
- **Before**: "Node.js 18+" or specific versions like "20.19.5"
- **After**: "Node.js 20 LTS or later" or "latest Node.js 20 LTS"

### Model Names
- **Before**: Hardcoded model IDs like `gpt-4o-mini`, `claude-sonnet-4-5`
- **After**: Generic terms like "current GPT-4 models", "Anthropic Claude models"
- **In Examples**: Still show specific models but with note that names may change

## Files Updated

✅ `package.json` - Updated to latest stable versions (Nov 2024)
✅ `VERSION_POLICY.md` - New file documenting versioning approach
✅ `DOCUMENTATION_UPDATES.md` - This file

## Current Package Versions

As of November 2024:
- better-sqlite3: 12.2.0
- express: 4.21.2
- openai: 6.9.0
- @anthropic-ai/sdk: 0.70.1
- Node.js: 20.18.1 LTS

## Maintenance

When updating packages:
1. Run `npm update` to get latest compatible versions
2. Update `VERSION_POLICY.md` with new versions
3. Test thoroughly
4. Commit with message like "chore: update dependencies to latest"

When model names change:
1. Update examples to use current model names
2. Keep note in VERSION_POLICY.md that names evolve
3. Link to provider docs for current model list

## Benefits

1. **Documentation stays current** - No specific versions to update
2. **Flexibility** - Users can use latest compatible versions
3. **Clear guidance** - VERSION_POLICY.md shows what's actually used
4. **Less maintenance** - Don't update docs every time a package releases
