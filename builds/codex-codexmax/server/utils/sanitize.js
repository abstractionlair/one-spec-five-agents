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

  // Normalize path
  clean = path.normalize(clean);

  if (clean.startsWith('..')) {
    throw new Error('Invalid path: cannot escape project directory');
  }

  return clean;
}

module.exports = { sanitizePath };
