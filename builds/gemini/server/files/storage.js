const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');
const { newId } = require('../db/projects');
const { sanitizePath } = require('../utils/sanitize');
const { hashContent } = require('../utils/hash');
const { indexFile } = require('../indexing/indexer');
const { getProjectPath } = require('../utils/paths');

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

  // Auto-index if text file
  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    try {
      await indexFile(fileId);
    } catch (err) {
      console.error('Indexing error:', err);
      // Don't fail file creation if indexing fails
    }
  }

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

  // Re-index
  try {
    await indexFile(fileId);
  } catch (err) {
    console.error('Reindexing error:', err);
  }

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
