const path = require('path');

const PROJECTS_ROOT = path.join(__dirname, '../../projects');

/**
 * Get absolute path to project directory
 */
function getProjectPath(projectId) {
  return path.join(PROJECTS_ROOT, projectId, 'files');
}

module.exports = { getProjectPath, PROJECTS_ROOT };
