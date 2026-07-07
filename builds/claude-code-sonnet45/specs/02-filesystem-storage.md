# Step 02: Filesystem Storage & File APIs

**Goal:** Store files on the filesystem, track metadata in the database, and provide APIs for file operations.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 01 (Database schema)

## Overview

This step implements file storage where:
1. **Files live on disk** in `projects/{project-id}/files/`
2. **Metadata lives in database** (`project_files` table)
3. **Content hash** detects changes for re-indexing

## Directory Structure

```
projects/
  proj_abc123_def456/
    files/
      data/
        sales.csv
      scripts/
        analyze.py
      README.md
```

## File Structure

```
server/
  files/
    storage.js       # Core file operations
    routes.js        # Express routes for file APIs
  utils/
    hash.js          # SHA256 hashing utility
    sanitize.js      # Path sanitization
  test-file-apis.js  # Integration tests
```

## Implementation

### 1. Path Utilities (server/utils/sanitize.js)

```javascript
const path = require('path');

/**
 * Sanitize user-provided file paths to prevent directory traversal
 */
function sanitizePath(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Invalid path: must be a non-empty string');
  }

  // Remove leading slashes
  let clean = userPath.replace(/^\/+/, '');

  // Prevent directory traversal
  if (clean.includes('..') || clean.includes('~')) {
    throw new Error('Invalid path: directory traversal not allowed');
  }

  // Normalize path (removes redundant separators, resolves . and ..)
  clean = path.normalize(clean);

  // Ensure still doesn't escape after normalization
  if (clean.startsWith('..')) {
    throw new Error('Invalid path: cannot escape project directory');
  }

  return clean;
}

module.exports = { sanitizePath };
```

### 2. Hash Utility (server/utils/hash.js)

```javascript
const crypto = require('crypto');

/**
 * Generate SHA256 hash of content for change detection
 */
function hashContent(content) {
  if (Buffer.isBuffer(content)) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

module.exports = { hashContent };
```

### 3. File Storage Core (server/files/storage.js)

```javascript
const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');
const { newId } = require('../db/projects');
const { sanitizePath } = require('../utils/sanitize');
const { hashContent } = require('../utils/hash');

const PROJECTS_ROOT = path.join(__dirname, '../../projects');

/**
 * Get absolute path to project directory
 */
function getProjectPath(projectId) {
  return path.join(PROJECTS_ROOT, projectId, 'files');
}

/**
 * Ensure project directory exists
 */
async function ensureProjectDirectory(projectId) {
  const projectPath = getProjectPath(projectId);
  await fs.mkdir(projectPath, { recursive: true });
  return projectPath;
}

/**
 * Upload/create a file in the project
 */
async function createFile(projectId, filePath, content, mimeType = 'text/plain') {
  // Sanitize path
  const sanitized = sanitizePath(filePath);

  // Ensure project directory exists
  const projectPath = await ensureProjectDirectory(projectId);

  // Full file path
  const fullPath = path.join(projectPath, sanitized);

  // Create parent directories
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Write file
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  await fs.writeFile(fullPath, buffer);

  // Calculate hash and size
  const contentHash = hashContent(buffer);
  const sizeBytes = buffer.length;

  // Store metadata in database
  const fileId = newId('file');
  const now = Date.now();

  db.prepare(`
    INSERT INTO project_files (
      id, project_id, path, content_hash, mime_type, size_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fileId, projectId, sanitized, contentHash, mimeType, sizeBytes, now, now);

  return getFile(fileId);
}

/**
 * Get file metadata from database
 */
function getFile(fileId) {
  const stmt = db.prepare('SELECT * FROM project_files WHERE id = ?');
  return stmt.get(fileId);
}

/**
 * Get file by project and path
 */
function getFileByPath(projectId, filePath) {
  const sanitized = sanitizePath(filePath);
  const stmt = db.prepare(`
    SELECT * FROM project_files
    WHERE project_id = ? AND path = ?
  `);
  return stmt.get(projectId, sanitized);
}

/**
 * Read file content from filesystem
 */
async function readFileContent(fileId) {
  const file = getFile(fileId);
  if (!file) throw new Error('File not found');

  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);

  const content = await fs.readFile(fullPath);
  return content;
}

/**
 * List all files in a project
 */
function listFiles(projectId) {
  const stmt = db.prepare(`
    SELECT * FROM project_files
    WHERE project_id = ?
    ORDER BY path
  `);
  return stmt.all(projectId);
}

/**
 * Update file content
 */
async function updateFile(fileId, content) {
  const file = getFile(fileId);
  if (!file) throw new Error('File not found');

  // Write to filesystem
  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);

  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  await fs.writeFile(fullPath, buffer);

  // Update metadata
  const contentHash = hashContent(buffer);
  const sizeBytes = buffer.length;
  const now = Date.now();

  db.prepare(`
    UPDATE project_files
    SET content_hash = ?, size_bytes = ?, updated_at = ?
    WHERE id = ?
  `).run(contentHash, sizeBytes, now, fileId);

  return getFile(fileId);
}

/**
 * Delete file
 */
async function deleteFile(fileId) {
  const file = getFile(fileId);
  if (!file) return false;

  // Delete from filesystem
  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);

  try {
    await fs.unlink(fullPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // File already deleted from filesystem, continue
  }

  // Delete from database
  db.prepare('DELETE FROM project_files WHERE id = ?').run(fileId);

  return true;
}

/**
 * Check if file content has changed (for re-indexing)
 */
async function hasFileChanged(fileId) {
  const file = getFile(fileId);
  if (!file) throw new Error('File not found');

  const content = await readFileContent(fileId);
  const currentHash = hashContent(content);

  return currentHash !== file.content_hash;
}

module.exports = {
  getProjectPath,
  ensureProjectDirectory,
  createFile,
  getFile,
  getFileByPath,
  readFileContent,
  listFiles,
  updateFile,
  deleteFile,
  hasFileChanged
};
```

### 4. File Routes (server/files/routes.js)

```javascript
const express = require('express');
const multer = require('multer');
const {
  createFile,
  getFile,
  readFileContent,
  listFiles,
  updateFile,
  deleteFile
} = require('./storage');

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/projects/:projectId/files
 * Upload a file
 */
router.post('/projects/:projectId/files', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { path: filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const file = await createFile(
      projectId,
      filePath,
      req.file.buffer,
      req.file.mimetype
    );

    res.json({ file });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/:projectId/files/text
 * Create a text file with string content
 */
router.post('/projects/:projectId/files/text', express.json(), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { path: filePath, content, mimeType } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    if (content === undefined) {
      return res.status(400).json({ error: 'content is required' });
    }

    const file = await createFile(
      projectId,
      filePath,
      content,
      mimeType || 'text/plain'
    );

    res.json({ file });
  } catch (err) {
    console.error('File creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:projectId/files
 * List all files in project
 */
router.get('/projects/:projectId/files', (req, res) => {
  try {
    const { projectId } = req.params;
    const files = listFiles(projectId);
    res.json({ files });
  } catch (err) {
    console.error('File listing error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/files/:fileId
 * Get file metadata
 */
router.get('/files/:fileId', (req, res) => {
  try {
    const { fileId } = req.params;
    const file = getFile(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({ file });
  } catch (err) {
    console.error('File retrieval error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/files/:fileId/content
 * Get file content
 */
router.get('/files/:fileId/content', async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = getFile(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = await readFileContent(fileId);

    res.set('Content-Type', file.mime_type || 'application/octet-stream');
    res.send(content);
  } catch (err) {
    console.error('File content error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/files/:fileId
 * Update file content
 */
router.put('/files/:fileId', express.raw({ limit: '10mb' }), async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await updateFile(fileId, req.body);
    res.json({ file });
  } catch (err) {
    console.error('File update error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/files/:fileId
 * Delete file
 */
router.delete('/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const deleted = await deleteFile(fileId);

    if (!deleted) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('File deletion error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

### 5. Integration Test (server/test-file-apis.js)

```javascript
const { createProject } = require('./db/projects');
const {
  createFile,
  getFile,
  getFileByPath,
  readFileContent,
  listFiles,
  updateFile,
  deleteFile,
  hasFileChanged
} = require('./files/storage');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing File Storage ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('File Test Project', 'Testing file storage');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Test file creation
    console.log('2. Testing file creation...');
    const file1 = await createFile(
      testProject.id,
      'test.txt',
      'Hello, world!',
      'text/plain'
    );
    console.log(`  ✓ Created file ${file1.id} at ${file1.path}`);

    // Verify file exists on filesystem
    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const filePath = path.join(projectPath, 'test.txt');
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) throw new Error('File not written to filesystem');
    console.log('  ✓ File exists on filesystem\n');

    // Test file reading
    console.log('3. Testing file reading...');
    const content = await readFileContent(file1.id);
    if (content.toString('utf-8') !== 'Hello, world!') {
      throw new Error('File content mismatch');
    }
    console.log('  ✓ Can read file content\n');

    // Test file listing
    console.log('4. Testing file listing...');
    await createFile(testProject.id, 'data/sales.csv', 'col1,col2\n1,2', 'text/csv');
    await createFile(testProject.id, 'scripts/run.py', 'print("hi")', 'text/x-python');

    const files = listFiles(testProject.id);
    if (files.length !== 3) {
      throw new Error(`Expected 3 files, got ${files.length}`);
    }
    console.log(`  ✓ Listed ${files.length} files`);
    files.forEach(f => console.log(`    - ${f.path}`));
    console.log();

    // Test file by path lookup
    console.log('5. Testing file lookup by path...');
    const foundFile = getFileByPath(testProject.id, 'data/sales.csv');
    if (!foundFile) throw new Error('File not found by path');
    console.log(`  ✓ Found file by path: ${foundFile.path}\n`);

    // Test file update
    console.log('6. Testing file update...');
    const updated = await updateFile(file1.id, 'Updated content');
    if (updated.content_hash === file1.content_hash) {
      throw new Error('Content hash did not change');
    }
    console.log('  ✓ File updated, hash changed\n');

    // Test change detection
    console.log('7. Testing change detection...');
    const changed = await hasFileChanged(file1.id);
    if (changed) throw new Error('File should not appear changed');
    console.log('  ✓ Change detection works\n');

    // Test file deletion
    console.log('8. Testing file deletion...');
    await deleteFile(file1.id);
    const deleted = getFile(file1.id);
    if (deleted) throw new Error('File still in database');

    const stillExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (stillExists) throw new Error('File still on filesystem');
    console.log('  ✓ File deleted from database and filesystem\n');

    // Test path sanitization
    console.log('9. Testing path sanitization...');
    try {
      await createFile(testProject.id, '../../../etc/passwd', 'hack');
      throw new Error('Should have rejected traversal');
    } catch (err) {
      if (!err.message.includes('traversal')) throw err;
      console.log('  ✓ Directory traversal blocked\n');
    }

    console.log('✅ All file storage tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      const { deleteProject } = require('./db/projects');
      deleteProject(testProject.id);

      // Delete project directory
      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
```

## Running

```bash
# Run integration tests
node server/test-file-apis.js
```

## Success Criteria

- [ ] Can create files in project directory
- [ ] Files written to `projects/{project-id}/files/{path}`
- [ ] Metadata stored in `project_files` table
- [ ] Can read file content from filesystem
- [ ] Can list all files in project
- [ ] Can update file content
- [ ] Can delete files (removes from DB and filesystem)
- [ ] Content hash calculated correctly
- [ ] Path sanitization prevents directory traversal
- [ ] Nested directories created automatically
- [ ] Test script passes

## Common Issues

**"ENOENT: no such file or directory"**
→ Ensure parent directories are created with `fs.mkdir(dirname, { recursive: true })`

**"Path traversal not blocked"**
→ Check `sanitizePath` function is being called on all user-provided paths

**"File exists but metadata missing"**
→ Ensure both filesystem write and DB insert succeed (consider using transactions)

## Next Steps

After this step completes:
- **Step 03:** Add conversation storage as markdown files
- **Step 06:** Add indexing to make files searchable

---

**Previous:** [01-project-setup-and-schema.md](01-project-setup-and-schema.md) | **Next:** [03-conversations-as-files.md](03-conversations-as-files.md)
