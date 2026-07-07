const { db } = require('./index');

function getConfig(key) {
    const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
    const result = stmt.get(key);

    if (!result) return null;

    try {
        return JSON.parse(result.value);
    } catch (err) {
        return result.value;
    }
}

function setConfig(key, value) {
    const now = Date.now();
    const jsonValue = JSON.stringify(value);

    const stmt = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `);

    stmt.run(key, jsonValue, now, jsonValue, now);
}

function deleteConfig(key) {
    const stmt = db.prepare('DELETE FROM config WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
}

function listConfig() {
    const stmt = db.prepare('SELECT key, value FROM config');
    const rows = stmt.all();

    const config = {};
    for (const row of rows) {
        try {
            config[row.key] = JSON.parse(row.value);
        } catch (err) {
            config[row.key] = row.value;
        }
    }

    return config;
}

module.exports = {
    getConfig,
    setConfig,
    deleteConfig,
    listConfig
};
