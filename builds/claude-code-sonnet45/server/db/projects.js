const { db } = require('./index');

function newId(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createProject(name, description = '', settings = {}) {
  const id = newId('proj');
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO projects (id, name, description, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, name, description, JSON.stringify(settings), now, now);

  return getProject(id);
}

function getProject(id) {
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const project = stmt.get(id);

  if (!project) return null;

  // Parse settings JSON
  if (project.settings) {
    project.settings = JSON.parse(project.settings);
  }

  return project;
}

function listProjects() {
  const stmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
  const projects = stmt.all();

  return projects.map(p => ({
    ...p,
    settings: p.settings ? JSON.parse(p.settings) : {}
  }));
}

function updateProject(id, updates) {
  const project = getProject(id);
  if (!project) throw new Error('Project not found');

  const { name, description, settings } = updates;
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE projects
    SET name = ?, description = ?, settings = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    name || project.name,
    description !== undefined ? description : project.description,
    JSON.stringify(settings || project.settings),
    now,
    id
  );

  return getProject(id);
}

function deleteProject(id) {
  const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

module.exports = {
  newId,
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject
};
