const crypto = require('crypto');

/**
 * Generate SHA256 hash of content for change detection
 */
function hashContent(content) {
    if (Buffer.isBuffer(content)) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

module.exports = { hashContent };
