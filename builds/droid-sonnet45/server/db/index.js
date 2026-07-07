const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../storage/data.db');

// Ensure storage directory exists
const storageDir = path.dirname(DB_PATH);
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Connect to database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Simple promise wrapper for compatibility with previous async init
const dbPromise = Promise.resolve(db);

module.exports = { db, dbPromise };
