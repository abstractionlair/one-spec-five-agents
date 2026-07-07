const { spawn } = require('child_process');
const path = require('path');
const { getProjectPath } = require('../files/storage');

const IMAGE_NAME = 'multimodelchat-executor';
const DEFAULT_TIMEOUT = 120000; // 120 seconds
const DEFAULT_MEMORY = '1g';
const DEFAULT_CPUS = '2.0';

/**
 * Execute bash command in Docker container
 */
async function executeBash(command, projectId, options = {}) {
    const {
        timeout = DEFAULT_TIMEOUT,
        memory = DEFAULT_MEMORY,
        cpus = DEFAULT_CPUS,
        network = 'bridge',  // 'bridge' for network access, 'none' for isolated
        env = {}
    } = options;

    // Get project directory path
    const projectPath = getProjectPath(projectId);

    // Build docker run command
    const dockerArgs = [
        'run',
        '--rm',                              // Remove container after execution
        '-v', `${projectPath}:/project:rw`,  // Mount project directory
        '-w', '/project',                    // Set working directory
        '--memory', memory,                  // Memory limit
        '--cpus', cpus,                      // CPU limit
        '--network', network,                // Network mode
        '--user', `${process.env.UID || 1000}:${process.env.GID || 1000}`, // Set user to host user ID to prevent permission issues
    ];

    // Add environment variables
    for (const [key, value] of Object.entries(env)) {
        dockerArgs.push('-e', `${key}=${value}`);
    }

    // Add image and command
    dockerArgs.push(IMAGE_NAME);
    dockerArgs.push('bash');
    dockerArgs.push('-c');
    dockerArgs.push(command);

    return new Promise((resolve, reject) => {
        const child = spawn('docker', dockerArgs);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        // Timeout handling
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Command timeout after ${timeout}ms`));
        }, timeout);

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                stdout,
                stderr,
                exit_code: code,
                success: code === 0
            });
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Docker execution error: ${err.message}`));
        });
    });
}

/**
 * Check if Docker is available
 */
async function isDockerAvailable() {
    return new Promise((resolve) => {
        const child = spawn('docker', ['--version']);
        child.on('close', (code) => {
            resolve(code === 0);
        });
        child.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Check if executor image exists
 */
async function isImageBuilt() {
    return new Promise((resolve) => {
        const child = spawn('docker', ['images', '-q', IMAGE_NAME]);
        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.on('close', () => {
            resolve(output.trim().length > 0);
        });
        child.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Build executor image
 */
async function buildImage() {
    const dockerfilePath = path.join(__dirname, 'Dockerfile');

    return new Promise((resolve, reject) => {
        const child = spawn('docker', [
            'build',
            '-t', IMAGE_NAME,
            '-f', dockerfilePath,
            path.dirname(dockerfilePath)
        ], {
            stdio: 'inherit'  // Show build output
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Docker build failed with code ${code}`));
            }
        });

        child.on('error', (err) => {
            reject(new Error(`Docker build error: ${err.message}`));
        });
    });
}

module.exports = {
    executeBash,
    isDockerAvailable,
    isImageBuilt,
    buildImage,
    IMAGE_NAME
};
