const { db } = require('./index');
const fs = require('fs');
const path = require('path');

function getCurrentVersion() {
  try {
    const result = db.prepare('SELECT value FROM config WHERE key = ?')
      .get('schema_version');
    return result ? parseInt(JSON.parse(result.value)) : 0;
  } catch (err) {
    return 0;
  }
}

function setVersion(version) {
  const stmt = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `);
  const now = Date.now();
  const value = JSON.stringify(version);
  stmt.run('schema_version', value, now, value, now);
}

function runMigrations() {
  const currentVersion = getCurrentVersion();
  console.log(`Current schema version: ${currentVersion}`);

  // Migration 1: Initial schema
  if (currentVersion < 1) {
    console.log('Running migration 1: Initial schema...');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );

    // Execute schema (split by semicolons for better-sqlite3)
    const statements = schemaSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      db.exec(statement);
    }

    setVersion(1);
    console.log('✓ Migration 1 complete');
  }

  console.log('All migrations complete');
}

module.exports = { runMigrations };
