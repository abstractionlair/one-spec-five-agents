const { spawn } = require('child_process');
const path = require('path');
const { getProjectPath } = require('../files/storage');

const IMAGE_NAME = 'multimodelchat-executor';
const DEFAULT_TIMEOUT = 60000;
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
    network = 'bridge',
    env = {}
  } = options;

  const projectPath = getProjectPath(projectId);

  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    `${projectPath}:/project:rw`,
    '-w',
    '/project',
    '--memory',
    memory,
    '--cpus',
    cpus,
    '--network',
    network,
    '--user',
    `${process.env.UID || 1000}:${process.env.GID || 1000}`
  ];

  for (const [key, value] of Object.entries(env)) {
    dockerArgs.push('-e', `${key}=${value}`);
  }

  dockerArgs.push(IMAGE_NAME, 'bash', '-c', command);

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
 * Check if Docker CLI is available
 */
async function isDockerAvailable() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['--version']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
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
    child.on('close', () => resolve(output.trim().length > 0));
    child.on('error', () => resolve(false));
  });
}

/**
 * Build executor image
 */
async function buildImage() {
  const dockerfilePath = path.join(__dirname, 'Dockerfile');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['build', '-t', IMAGE_NAME, '-f', dockerfilePath, path.dirname(dockerfilePath)],
      { stdio: 'inherit' }
    );

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });

    child.on('error', (err) => reject(new Error(`Docker build error: ${err.message}`)));
  });
}

module.exports = {
  executeBash,
  isDockerAvailable,
  isImageBuilt,
  buildImage,
  IMAGE_NAME
};
