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
  const sanitized = sanitizePath(filePath);
  const projectPath = await ensureProjectDirectory(projectId);
  const fullPath = path.join(projectPath, sanitized);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  await fs.writeFile(fullPath, buffer);

  const contentHash = hashContent(buffer);
  const sizeBytes = buffer.length;
  const fileId = newId('file');
  const now = Date.now();

  db.prepare(
    `INSERT INTO project_files (
      id, project_id, path, content_hash, mime_type, size_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(fileId, projectId, sanitized, contentHash, mimeType, sizeBytes, now, now);

  const created = getFile(fileId);

  // Auto-index if available and text-like
  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    try {
      const { indexFile } = require('../indexing/indexer');
      await indexFile(fileId);
    } catch (err) {
      console.error('Indexing error:', err);
    }
  }

  return created;
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
  const stmt = db.prepare(
    `SELECT * FROM project_files
     WHERE project_id = ? AND path = ?`
  );
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
  const stmt = db.prepare(
    `SELECT * FROM project_files
     WHERE project_id = ?
     ORDER BY path`
  );
  return stmt.all(projectId);
}

/**
 * Update file content
 */
async function updateFile(fileId, content) {
  const file = getFile(fileId);
  if (!file) throw new Error('File not found');

  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);

  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  await fs.writeFile(fullPath, buffer);

  const contentHash = hashContent(buffer);
  const sizeBytes = buffer.length;
  const now = Date.now();

  db.prepare(
    `UPDATE project_files
     SET content_hash = ?, size_bytes = ?, updated_at = ?
     WHERE id = ?`
  ).run(contentHash, sizeBytes, now, fileId);

  const updated = getFile(fileId);

  if (updated.mime_type?.startsWith('text/') || updated.mime_type === 'application/json') {
    try {
      const { indexFile } = require('../indexing/indexer');
      await indexFile(fileId);
    } catch (err) {
      console.error('Reindexing error:', err);
    }
  }

  return updated;
}

/**
 * Delete file
 */
async function deleteFile(fileId) {
  const file = getFile(fileId);
  if (!file) return false;

  const projectPath = getProjectPath(file.project_id);
  const fullPath = path.join(projectPath, file.path);

  try {
    await fs.unlink(fullPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

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
