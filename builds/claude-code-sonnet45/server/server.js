require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { runMigrations } = require('./db/migrations');
const projectRoutes = require('./routes/projects');
const fileRoutes = require('./files/routes');
const conversationRoutes = require('./conversations/routes');
const turnRoutes = require('./routes/turn');
const searchRoutes = require('./indexing/search');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Run database migrations on startup
try {
  runMigrations();
  console.log('✓ Database initialized');
} catch (err) {
  console.error('Failed to initialize database:', err);
  process.exit(1);
}

// API Routes
app.use('/api', projectRoutes);
app.use('/api', fileRoutes);
app.use('/api', conversationRoutes);
app.use('/api', turnRoutes);
app.use('/api', searchRoutes);

// Serve static web UI
app.use(express.static(path.join(__dirname, '../web')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Multi-Model Chat Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   API:  http://localhost:${PORT}/api`);
  console.log(`   Web:  http://localhost:${PORT}`);
  console.log();
});

module.exports = app;
