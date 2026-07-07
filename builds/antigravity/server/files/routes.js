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
