/**
 * Simple YAML formatter for frontmatter
 * Handles strings, numbers, booleans, and nested objects (one level)
 */
function formatYAML(obj, indent = 0) {
    const spaces = ' '.repeat(indent);
    const lines = [];

    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            // Nested object
            lines.push(`${spaces}${key}:`);
            for (const [k, v] of Object.entries(value)) {
                lines.push(`${spaces}  ${k}: ${v}`);
            }
        } else {
            // Primitive value
            lines.push(`${spaces}${key}: ${value}`);
        }
    }

    return lines.join('\n');
}

/**
 * Simple YAML parser for frontmatter
 * Handles strings, numbers, booleans, and nested objects (one level)
 */
function parseYAML(yamlStr) {
    const lines = yamlStr.split('\n').filter(l => l.trim());
    const result = {};
    let currentKey = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Check for nested object (indented)
        if (line.startsWith('  ') && currentKey) {
            const match = trimmed.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, value] = match;
                if (!result[currentKey]) result[currentKey] = {};
                result[currentKey][key] = parseValue(value);
            }
        } else {
            // Top-level key
            const match = trimmed.match(/^(\w+):\s*(.*)$/);
            if (match) {
                const [, key, value] = match;
                currentKey = key;
                if (value) {
                    result[key] = parseValue(value);
                } else {
                    result[key] = {};
                }
            }
        }
    }

    return result;
}

function parseValue(str) {
    // Number
    if (/^\d+(\.\d+)?$/.test(str)) {
        return parseFloat(str);
    }
    // Boolean
    if (str === 'true') return true;
    if (str === 'false') return false;
    // String
    return str;
}

module.exports = { formatYAML, parseYAML };
