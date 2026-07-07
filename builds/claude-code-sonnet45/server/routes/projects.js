const express = require('express');
const {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject
} = require('../db/projects');

const router = express.Router();

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/projects', express.json(), (req, res) => {
  try {
    const { name, description, settings } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const project = createProject(name, description, settings);
    res.json({ project });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects
 * List all projects
 */
router.get('/projects', (req, res) => {
  try {
    const projects = listProjects();
    res.json({ projects });
  } catch (err) {
    console.error('List projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id
 * Get a specific project
 */
router.get('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const project = getProject(id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ project });
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/projects/:id
 * Update a project
 */
router.put('/projects/:id', express.json(), (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const project = updateProject(id, updates);
    res.json({ project });
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = deleteProject(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
